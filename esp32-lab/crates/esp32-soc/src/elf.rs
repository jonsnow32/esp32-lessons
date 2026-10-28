//! Minimal ELF32 little-endian reader: program headers and the symbol table are all we need.

use std::collections::HashMap;

#[derive(Debug)]
pub struct Segment {
    pub vaddr: u32,
    pub data: Vec<u8>,
    pub mem_size: u32,
}

pub struct Elf {
    pub entry: u32,
    pub segments: Vec<Segment>,
    /// Function, object and absolute symbols: name → address.
    pub symbols: HashMap<String, u32>,
}

fn u16_at(d: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([d[o], d[o + 1]])
}

fn u32_at(d: &[u8], o: usize) -> u32 {
    u32::from_le_bytes(d[o..o + 4].try_into().unwrap())
}

impl Elf {
    pub fn parse(d: &[u8]) -> Result<Elf, String> {
        if d.len() < 52 || &d[0..4] != b"\x7fELF" || d[4] != 1 || d[5] != 1 {
            return Err("not a 32-bit little-endian ELF file".into());
        }
        let entry = u32_at(d, 24);
        let (phoff, shoff) = (u32_at(d, 28) as usize, u32_at(d, 32) as usize);
        let (phentsize, phnum) = (u16_at(d, 42) as usize, u16_at(d, 44) as usize);
        let (shentsize, shnum) = (u16_at(d, 46) as usize, u16_at(d, 48) as usize);

        let mut segments = vec![];
        for k in 0..phnum {
            let p = phoff + k * phentsize;
            if u32_at(d, p) != 1 {
                continue; // PT_LOAD only
            }
            let (off, vaddr, filesz, memsz) = (u32_at(d, p + 4), u32_at(d, p + 8), u32_at(d, p + 16), u32_at(d, p + 20));
            let data = d.get(off as usize..(off + filesz) as usize).ok_or("segment outside file")?.to_vec();
            segments.push(Segment { vaddr, data, mem_size: memsz });
        }

        let mut symbols = HashMap::new();
        for k in 0..shnum {
            let s = shoff + k * shentsize;
            if u32_at(d, s + 4) != 2 {
                continue; // SHT_SYMTAB
            }
            let (off, size, link, entsize) =
                (u32_at(d, s + 16) as usize, u32_at(d, s + 20) as usize, u32_at(d, s + 24) as usize, u32_at(d, s + 36) as usize);
            let strtab = shoff + link * shentsize;
            let str_off = u32_at(d, strtab + 16) as usize;
            for e in (off..off + size).step_by(entsize.max(16)) {
                let name_off = u32_at(d, e) as usize;
                let value = u32_at(d, e + 4);
                // 0 = NOTYPE (ROM addresses PROVIDEd by esp32.rom*.ld), 1 = OBJECT, 2 = FUNC
                let kind = d[e + 12] & 0xf;
                if kind > 2 || name_off == 0 {
                    continue;
                }
                let start = str_off + name_off;
                let end = d[start..].iter().position(|&c| c == 0).map(|n| start + n).unwrap_or(start);
                if let Ok(name) = std::str::from_utf8(&d[start..end]) {
                    symbols.entry(name.to_string()).or_insert(value);
                }
            }
        }
        Ok(Elf { entry, segments, symbols })
    }
}
