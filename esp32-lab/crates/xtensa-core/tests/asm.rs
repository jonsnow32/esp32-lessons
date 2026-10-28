//! Bare-metal programs assembled with the real ESP32 toolchain and run on the interpreter.
//! Skipped (with a message) when the toolchain is not installed; set XTENSA_TOOLCHAIN to the
//! toolchain's bin/ directory if it is not in the PlatformIO default location.

use std::path::{Path, PathBuf};
use std::process::Command;
use xtensa_core::{Cpu, FlatMemory, Step};

const BASE: u32 = 0x4008_0000;
const SIZE: usize = 0x20000;

fn toolchain() -> Option<PathBuf> {
    let dir = std::env::var_os("XTENSA_TOOLCHAIN").map(PathBuf::from).unwrap_or_else(|| {
        let home = std::env::var_os("HOME").unwrap_or_default();
        Path::new(&home).join(".platformio/packages/toolchain-xtensa-esp-elf/bin")
    });
    dir.join("xtensa-esp32-elf-as").exists().then_some(dir)
}

struct Program {
    mem: FlatMemory,
    entry: u32,
    symbols: std::collections::HashMap<String, u32>,
}

fn build(name: &str) -> Option<Program> {
    let Some(tc) = toolchain() else {
        eprintln!("skipping {name}: xtensa-esp32-elf toolchain not found");
        return None;
    };
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/asm");
    let out = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    std::fs::create_dir_all(&out).unwrap();
    let tool = |t: &str| tc.join(format!("xtensa-esp32-elf-{t}"));
    let run = |cmd: &mut Command| {
        let o = cmd.output().unwrap();
        assert!(o.status.success(), "{:?}: {}", cmd, String::from_utf8_lossy(&o.stderr));
        o.stdout
    };
    let mut objs = vec![];
    for file in ["vectors.S", &format!("{name}.S")] {
        let obj = out.join(format!("{file}.o"));
        run(Command::new(tool("as")).args(["--text-section-literals", "-o"]).arg(&obj).arg(src.join(file)));
        objs.push(obj);
    }
    let elf = out.join("prog.elf");
    run(Command::new(tool("ld"))
        .args(["-e", "_start", &format!("-Ttext=0x{BASE:x}"), &format!("-Tdata=0x{:x}", BASE + 0x8000)])
        .arg(format!("--defsym=_stack_top=0x{:x}", BASE + SIZE as u32 - 16))
        .arg("-o")
        .arg(&elf)
        .args(&objs));
    let bin = out.join("prog.bin");
    run(Command::new(tool("objcopy")).args(["-O", "binary"]).arg(&elf).arg(&bin));
    let nm = String::from_utf8(run(Command::new(tool("nm")).arg(&elf))).unwrap();
    let symbols = nm
        .lines()
        .filter_map(|l| {
            let mut p = l.split_whitespace();
            let addr = u32::from_str_radix(p.next()?, 16).ok()?;
            p.next()?;
            Some((p.next()?.to_string(), addr))
        })
        .collect::<std::collections::HashMap<_, _>>();
    let mut mem = FlatMemory::new(BASE, SIZE);
    mem.load(BASE, &std::fs::read(&bin).unwrap());
    Some(Program { mem, entry: symbols["_start"], symbols })
}

/// Run until BREAK; returns the break code and the CPU.
fn run(p: &mut Program, max_steps: u64) -> (Step, Cpu) {
    let mut cpu = Cpu::new(p.entry, 0xcdcd);
    for _ in 0..max_steps {
        let (pc, wb, ws, ps) = (cpu.pc, cpu.windowbase, cpu.windowstart, cpu.ps);
        let step = cpu.step(&mut p.mem);
        if std::env::var_os("XTENSA_TRACE").is_some() && ((pc & 0xfffffc00) == 0x4008_0000 || (cpu.pc & 0xfffffc00) == 0x4008_0000) {
            eprintln!("vector {:08x} from pc={pc:08x} wb={wb} ws={ws:04x} ps={ps:x} a1={:08x} a5={:08x} a11={:08x} a13={:08x} excvaddr={:08x} exccause={}", cpu.pc, cpu.a(1), cpu.a(5), cpu.a(11), cpu.a(13), cpu.excvaddr, cpu.exccause);
        }
        match step {
            Step::Ok | Step::Exception { .. } => {}
            // Fast-forward idle time to the next timer match
            Step::Waiting => cpu.tick(cpu.cycles_to_next_timer()),
            brk @ Step::Break { .. } => return (brk, cpu),
        }
    }
    panic!("no BREAK after {max_steps} steps, pc={:08x}", cpu.pc);
}

fn word(p: &Program, sym: &str, index: u32) -> u32 {
    let addr = p.symbols[sym] + 4 * index;
    let off = (addr - BASE) as usize;
    u32::from_le_bytes(p.mem.data[off..off + 4].try_into().unwrap())
}

#[test]
fn recursive_calls_spill_and_fill_register_windows() {
    let Some(mut p) = build("fib") else { return };
    let (brk, cpu) = run(&mut p, 10_000_000);
    assert_eq!(brk, Step::Break { s: 1, t: 15 });
    assert_eq!(word(&p, "result", 0), 6765, "fib(20) via CALL8");
    assert_eq!(word(&p, "result", 1), 144, "fib(12) via CALL12");
    assert_eq!(cpu.windowbase, 0);
}

#[test]
fn alu_loops_shifts_division_atomics() {
    let Some(mut p) = build("alu") else { return };
    let (brk, _) = run(&mut p, 100_000);
    assert_eq!(brk, Step::Break { s: 1, t: 15 });
    let r: Vec<u32> = (0..8).map(|k| word(&p, "result", k)).collect();
    assert_eq!(r[0], 5050);
    assert_eq!(r[1], 3_628_800);
    assert_eq!(r[2], ((-14i32 << 8) as u32) | 0xfe);
    assert_eq!(r[3], 0x6789_abcd);
    assert_eq!(r[4], 0x81c);
    assert_eq!(r[5] as i32, -1);
    assert_eq!(r[7], 125);
}

#[test]
fn ccompare_interrupt_wakes_waiti() {
    let Some(mut p) = build("timer") else { return };
    let (brk, cpu) = run(&mut p, 100_000);
    assert_eq!(brk, Step::Break { s: 1, t: 15 });
    assert_eq!(word(&p, "result", 0), 3);
    assert!(cpu.ccount >= 3 * 0x1000, "idle time was fast-forwarded");
}

#[test]
fn floating_point_and_coprocessor_trap() {
    let Some(mut p) = build("float") else { return };
    let (brk, cpu) = run(&mut p, 100_000);
    assert_eq!(word(&p, "result", 0), 31);
    assert_eq!(word(&p, "result", 1), 1);
    // The final add.s runs with CPENABLE = 0 and must trap
    assert_eq!(brk, Step::Break { s: 1, t: 2 });
    assert_eq!(cpu.exccause, 32);
}
