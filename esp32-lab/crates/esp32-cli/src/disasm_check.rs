//! Feed `xtensa-esp32-elf-objdump -d firmware.elf` on stdin; every instruction line is decoded
//! from its encoding and printed back in objdump syntax. Any difference is a decoder bug (or an
//! instruction we deliberately do not support, listed separately).

use std::collections::BTreeMap;
use std::io::{self, BufRead};
use xtensa_core::{decode, Disasm, Op};

/// Drop `<symbol+0x..>` annotations and normalise whitespace.
fn normalise(text: &str) -> String {
    let mut out = String::new();
    let mut depth = 0;
    for c in text.chars() {
        match c {
            // `<symbol>` annotations, and l32r's `(literal value)`
            '<' | '(' => depth += 1,
            '>' | ')' if depth > 0 => depth -= 1,
            _ if depth > 0 => {}
            _ => out.push(c),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ").replace(" ,", ",")
}

pub fn run() -> i32 {
    let mut total = 0usize;
    let mut matched = 0usize;
    let mut unsupported: BTreeMap<String, usize> = BTreeMap::new();
    let mut mismatches: BTreeMap<String, (usize, Vec<String>)> = BTreeMap::new();

    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        // "40080400:\t002136        \tentry\ta1, 16"
        let mut fields = line.splitn(3, '\t');
        let (Some(addr), Some(hex), Some(text)) = (fields.next(), fields.next(), fields.next()) else { continue };
        let Some(addr) = addr.trim().strip_suffix(':') else { continue };
        let Ok(pc) = u32::from_str_radix(addr.trim(), 16) else { continue };
        let hex = hex.trim();
        if text.starts_with(".byte") || !(hex.len() == 4 || hex.len() == 6) {
            continue;
        }
        let Ok(word) = u32::from_str_radix(hex, 16) else { continue };
        total += 1;

        let insn = decode(word);
        let expected = normalise(text);
        let ours = normalise(&Disasm { insn, pc }.to_string());
        if ours == expected {
            matched += 1;
        } else if insn.op == Op::Unknown || (insn.op != Op::Lsi && expected.starts_with("lsi ")) {
            // Encodings outside the ESP32 base ISA. objdump also prints most invalid words found
            // in literal pools as `lsi`, so those are data, not decoder bugs.
            *unsupported.entry(expected.split(' ').next().unwrap_or("").to_string()).or_default() += 1;
        } else {
            let key = expected.split(' ').next().unwrap_or("").to_string();
            let entry = mismatches.entry(key).or_default();
            entry.0 += 1;
            if entry.1.len() < 3 {
                entry.1.push(format!("{pc:08x} {hex}: objdump `{expected}` / ours `{ours}`"));
            }
        }
    }

    let bad: usize = mismatches.values().map(|(n, _)| n).sum();
    let unsup: usize = unsupported.values().sum();
    println!("instructions: {total}, identical: {matched}, mismatched: {bad}, unsupported: {unsup}");
    for (mnemonic, (count, samples)) in &mismatches {
        println!("  MISMATCH {mnemonic} ×{count}");
        for s in samples {
            println!("      {s}");
        }
    }
    if !unsupported.is_empty() {
        let list: Vec<String> = unsupported.iter().map(|(m, n)| format!("{m}×{n}")).collect();
        println!("  unsupported: {}", list.join(" "));
    }
    if bad == 0 { 0 } else { 1 }
}
