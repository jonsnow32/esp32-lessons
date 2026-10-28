//! Disassembly in GNU objdump syntax, so decoder output can be diffed against
//! `xtensa-esp32-elf-objdump -d` line by line (see `esp32-cli disasm-check`).

use crate::decode::{Insn, Op};
use std::fmt;

/// Special register names as objdump prints them (`rsr.<name>`).
pub fn sr_name(sr: u32, write: bool) -> Option<&'static str> {
    Some(match sr {
        0 => "lbeg",
        1 => "lend",
        2 => "lcount",
        3 => "sar",
        4 => "br",
        5 => "litbase",
        12 => "scompare1",
        16 => "acclo",
        17 => "acchi",
        32 => "m0",
        33 => "m1",
        34 => "m2",
        35 => "m3",
        72 => "windowbase",
        73 => "windowstart",
        96 => "ibreakenable",
        97 => "memctl",
        99 => "atomctl",
        104 => "ddr",
        128 => "ibreaka0",
        129 => "ibreaka1",
        144 => "dbreaka0",
        145 => "dbreaka1",
        160 => "dbreakc0",
        161 => "dbreakc1",
        176 => "configid0",
        177 => "epc1",
        178 => "epc2",
        179 => "epc3",
        180 => "epc4",
        181 => "epc5",
        182 => "epc6",
        183 => "epc7",
        192 => "depc",
        194 => "eps2",
        195 => "eps3",
        196 => "eps4",
        197 => "eps5",
        198 => "eps6",
        199 => "eps7",
        208 => "configid1",
        209 => "excsave1",
        210 => "excsave2",
        211 => "excsave3",
        212 => "excsave4",
        213 => "excsave5",
        214 => "excsave6",
        215 => "excsave7",
        224 => "cpenable",
        226 if write => "intset",
        226 => "interrupt",
        227 => "intclear",
        228 => "intenable",
        230 => "ps",
        231 => "vecbase",
        232 => "exccause",
        233 => "debugcause",
        234 => "ccount",
        235 => "prid",
        236 => "icount",
        237 => "icountlevel",
        238 => "excvaddr",
        240 => "ccompare0",
        241 => "ccompare1",
        242 => "ccompare2",
        244 => "misc0",
        245 => "misc1",
        246 => "misc2",
        247 => "misc3",
        _ => return None,
    })
}

pub fn ur_name(ur: u32) -> Option<&'static str> {
    Some(match ur {
        231 => "threadptr",
        232 => "fcr",
        233 => "fsr",
        // ESP32 double-precision assist registers
        234 => "f64r_lo",
        235 => "f64r_hi",
        236 => "f64s",
        _ => return None,
    })
}

pub fn mnemonic(op: Op) -> &'static str {
    use Op::*;
    match op {
        Ill => "ill", Ret => "ret", Retw => "retw", Jx => "jx",
        Callx0 => "callx0", Callx4 => "callx4", Callx8 => "callx8", Callx12 => "callx12",
        Movsp => "movsp", Isync => "isync", Rsync => "rsync", Esync => "esync", Dsync => "dsync",
        Excw => "excw", Memw => "memw", Extw => "extw", Nop => "nop",
        Rfe => "rfe", Rfue => "rfue", Rfde => "rfde", Rfwo => "rfwo", Rfwu => "rfwu", Rfi => "rfi", Rfme => "rfme",
        Break => "break", Syscall => "syscall", Simcall => "simcall", Rsil => "rsil", Waiti => "waiti",
        Any4 => "any4", All4 => "all4", Any8 => "any8", All8 => "all8",
        And => "and", Or => "or", Xor => "xor",
        Ssr => "ssr", Ssl => "ssl", Ssa8l => "ssa8l", Ssa8b => "ssa8b", Ssai => "ssai",
        Rer => "rer", Wer => "wer", Rotw => "rotw", Nsa => "nsa", Nsau => "nsau",
        Neg => "neg", Abs => "abs", Add => "add", Addx2 => "addx2", Addx4 => "addx4", Addx8 => "addx8",
        Sub => "sub", Subx2 => "subx2", Subx4 => "subx4", Subx8 => "subx8",
        Slli => "slli", Srai => "srai", Srli => "srli", Xsr => "xsr",
        Src => "src", Srl => "srl", Sll => "sll", Sra => "sra", Mul16u => "mul16u", Mul16s => "mul16s",
        Andb => "andb", Andbc => "andbc", Orb => "orb", Orbc => "orbc", Xorb => "xorb",
        Mull => "mull", Muluh => "muluh", Mulsh => "mulsh", Quou => "quou", Quos => "quos", Remu => "remu", Rems => "rems",
        Rsr => "rsr", Wsr => "wsr", Sext => "sext", Clamps => "clamps",
        Min => "min", Max => "max", Minu => "minu", Maxu => "maxu",
        Moveqz => "moveqz", Movnez => "movnez", Movltz => "movltz", Movgez => "movgez",
        Movf => "movf", Movt => "movt", Rur => "rur", Wur => "wur", Extui => "extui",
        L32e => "l32e", S32e => "s32e", L32r => "l32r", L8ui => "l8ui", L16ui => "l16ui", L16si => "l16si",
        L32i => "l32i", S8i => "s8i", S16i => "s16i", S32i => "s32i", Cache => "cache",
        Movi => "movi", L32ai => "l32ai", Addi => "addi", Addmi => "addmi", S32c1i => "s32c1i", S32ri => "s32ri",
        Call0 => "call0", Call4 => "call4", Call8 => "call8", Call12 => "call12", J => "j", Entry => "entry",
        Beqz => "beqz", Bnez => "bnez", Bltz => "bltz", Bgez => "bgez",
        Beqi => "beqi", Bnei => "bnei", Blti => "blti", Bgei => "bgei", Bltui => "bltui", Bgeui => "bgeui",
        Bf => "bf", Bt => "bt", Loop => "loop", Loopnez => "loopnez", Loopgtz => "loopgtz",
        Bnone => "bnone", Beq => "beq", Blt => "blt", Bltu => "bltu", Ball => "ball", Bbc => "bbc", Bbci => "bbci",
        Bany => "bany", Bne => "bne", Bge => "bge", Bgeu => "bgeu", Bnall => "bnall", Bbs => "bbs", Bbsi => "bbsi",
        L32iN => "l32i.n", S32iN => "s32i.n", AddN => "add.n", AddiN => "addi.n", MoviN => "movi.n",
        BeqzN => "beqz.n", BnezN => "bnez.n", MovN => "mov.n", RetN => "ret.n", RetwN => "retw.n",
        BreakN => "break.n", NopN => "nop.n", IllN => "ill.n",
        Lsi => "lsi", Ssi => "ssi", Lsiu => "lsip", Ssiu => "ssip", Lsx => "lsx", Lsxu => "lsxp", Ssx => "ssx", Ssxu => "ssxp",
        AddS => "add.s", SubS => "sub.s", MulS => "mul.s", MaddS => "madd.s", MsubS => "msub.s",
        RoundS => "round.s", TruncS => "trunc.s", FloorS => "floor.s", CeilS => "ceil.s",
        FloatS => "float.s", UfloatS => "ufloat.s", UtruncS => "utrunc.s",
        MovS => "mov.s", AbsS => "abs.s", Rfr => "rfr", Wfr => "wfr", NegS => "neg.s",
        UnS => "un.s", OeqS => "oeq.s", UeqS => "ueq.s", OltS => "olt.s", UltS => "ult.s", OleS => "ole.s", UleS => "ule.s",
        MoveqzS => "moveqz.s", MovnezS => "movnez.s", MovltzS => "movltz.s", MovgezS => "movgez.s",
        MovfS => "movf.s", MovtS => "movt.s",
        Unknown => "<unknown>",
    }
}

fn cache_mnemonic(i: &Insn) -> &'static str {
    match (i.t, i.imm2) {
        (0, _) => "dpfr",
        (1, _) => "dpfw",
        (2, _) => "dpfro",
        (3, _) => "dpfwo",
        (4, _) => "dhwb",
        (5, _) => "dhwbi",
        (6, _) => "dhi",
        (7, _) => "dii",
        (8, 0) => "dpfl",
        (8, 2) => "dhu",
        (8, 3) => "diu",
        (8, 4) => "diwb",
        (8, 5) => "diwbi",
        (12, _) => "ipf",
        (13, 0) => "ipfl",
        (13, 2) => "ihu",
        (13, 3) => "iiu",
        (14, _) => "ihi",
        (15, _) => "iii",
        _ => "<unknown>",
    }
}

/// objdump prints immediates in −255..255 in decimal, anything else as 32-bit hex.
struct Imm(i32);

impl fmt::Display for Imm {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if (-255..=255).contains(&self.0) {
            write!(f, "{}", self.0)
        } else {
            write!(f, "0x{:x}", self.0 as u32)
        }
    }
}

/// An instruction at a given address, printable in objdump syntax.
pub struct Disasm {
    pub insn: Insn,
    pub pc: u32,
}

impl fmt::Display for Disasm {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        use Op::*;
        let i = &self.insn;
        let (r, s, t) = (i.r, i.s, i.t);
        let rel = |off: i32| self.pc.wrapping_add(off as u32);
        let m = mnemonic(i.op);
        match i.op {
            Ill | Ret | Retw | Isync | Rsync | Esync | Dsync | Excw | Memw | Extw | Nop | Rfe | Rfue | Rfde
            | Rfwo | Rfwu | Rfme | Syscall | Simcall | RetN | RetwN | NopN | IllN => write!(f, "{m}"),
            Jx | Callx0 | Callx4 | Callx8 | Callx12 | Ssr | Ssl | Ssa8l | Ssa8b => write!(f, "{m}\ta{s}"),
            Movsp | Nsa | Nsau | MovN => write!(f, "{m}\ta{t}, a{s}"),
            Rer | Wer => write!(f, "{m}\ta{t}, a{s}"),
            Rfi | Waiti => write!(f, "{m}\t{s}"),
            Rsil => write!(f, "{m}\ta{t}, {s}"),
            Break => write!(f, "{m}\t{s}, {t}"),
            BreakN => write!(f, "{m}\t{s}"),
            Ssai | Rotw => write!(f, "{m}\t{}", i.imm),
            Any4 | All4 => {
                let b = s & !3;
                write!(f, "{m}\tb{t}, b{b}:b{}:b{}:b{}", b + 1, b + 2, b + 3)
            }
            Any8 | All8 => {
                let b = s & !7;
                write!(f, "{m}\tb{t}, b{b}")?;
                for k in 1..8 {
                    write!(f, ":b{}", b + k)?;
                }
                Ok(())
            }
            And | Or | Xor | Add | Addx2 | Addx4 | Addx8 | Sub | Subx2 | Subx4 | Subx8 | Src | Mul16u | Mul16s
            | Mull | Muluh | Mulsh | Quou | Quos | Remu | Rems | Min | Max | Minu | Maxu | Moveqz | Movnez
            | Movltz | Movgez | AddN => write!(f, "{m}\ta{r}, a{s}, a{t}"),
            Movf | Movt => write!(f, "{m}\ta{r}, a{s}, b{t}"),
            Andb | Andbc | Orb | Orbc | Xorb => write!(f, "{m}\tb{r}, b{s}, b{t}"),
            Neg | Abs | Srl | Sra => write!(f, "{m}\ta{r}, a{t}"),
            Sll => write!(f, "{m}\ta{r}, a{s}"),
            Slli => write!(f, "{m}\ta{r}, a{s}, {}", i.imm),
            Srai | Srli => write!(f, "{m}\ta{r}, a{t}, {}", i.imm),
            Extui => write!(f, "{m}\ta{r}, a{t}, {}, {}", i.imm, i.imm2),
            Sext | Clamps => write!(f, "{m}\ta{r}, a{s}, {}", i.imm),
            Rsr | Wsr | Xsr => match sr_name(i.imm as u32, i.op == Wsr) {
                Some(name) => write!(f, "{m}.{name}\ta{t}"),
                None => write!(f, "{m}\ta{t}, {}", i.imm),
            },
            Rur => match ur_name(i.imm as u32) {
                Some(name) => write!(f, "{m}.{name}\ta{r}"),
                None => write!(f, "{m}\ta{r}, {}", i.imm),
            },
            Wur => match ur_name(i.imm as u32) {
                Some(name) => write!(f, "{m}.{name}\ta{t}"),
                None => write!(f, "{m}\ta{t}, {}", i.imm),
            },
            L32r => write!(f, "{m}\ta{t}, {:08x}", ((self.pc.wrapping_add(3)) & !3).wrapping_add(i.imm as u32)),
            L32e | S32e | L8ui | L16ui | L16si | L32i | S8i | S16i | S32i | L32ai | Addi | Addmi | S32c1i | S32ri
            | L32iN | S32iN => write!(f, "{m}\ta{t}, a{s}, {}", Imm(i.imm)),
            AddiN => write!(f, "{m}\ta{r}, a{s}, {}", i.imm),
            Cache => write!(f, "{}\ta{s}, {}", cache_mnemonic(i), Imm(i.imm)),
            Movi => write!(f, "{m}\ta{t}, {}", Imm(i.imm)),
            MoviN => write!(f, "{m}\ta{s}, {}", i.imm),
            Call0 | Call4 | Call8 | Call12 => write!(f, "{m}\t{:08x}", (self.pc & !3).wrapping_add(i.imm as u32)),
            J => write!(f, "{m}\t{:08x}", rel(i.imm)),
            Entry => write!(f, "{m}\ta{s}, {}", Imm(i.imm)),
            Beqz | Bnez | Bltz | Bgez | BeqzN | BnezN | Loop | Loopnez | Loopgtz => {
                write!(f, "{m}\ta{s}, {:08x}", rel(i.imm))
            }
            Bf | Bt => write!(f, "{m}\tb{s}, {:08x}", rel(i.imm)),
            Beqi | Bnei | Blti | Bgei | Bltui | Bgeui | Bbci | Bbsi => {
                write!(f, "{m}\ta{s}, {}, {:08x}", Imm(i.imm), rel(i.imm2))
            }
            Bnone | Beq | Blt | Bltu | Ball | Bbc | Bany | Bne | Bge | Bgeu | Bnall | Bbs => {
                write!(f, "{m}\ta{s}, a{t}, {:08x}", rel(i.imm))
            }
            Lsi | Ssi | Lsiu | Ssiu => write!(f, "{m}\tf{t}, a{s}, {}", Imm(i.imm)),
            Lsx | Lsxu | Ssx | Ssxu => write!(f, "{m}\tf{r}, a{s}, a{t}"),
            AddS | SubS | MulS | MaddS | MsubS => write!(f, "{m}\tf{r}, f{s}, f{t}"),
            RoundS | TruncS | FloorS | CeilS | UtruncS => write!(f, "{m}\ta{r}, f{s}, {t}"),
            FloatS | UfloatS => write!(f, "{m}\tf{r}, a{s}, {t}"),
            MovS | AbsS | NegS => write!(f, "{m}\tf{r}, f{s}"),
            Rfr => write!(f, "{m}\ta{r}, f{s}"),
            Wfr => write!(f, "{m}\tf{r}, a{s}"),
            UnS | OeqS | UeqS | OltS | UltS | OleS | UleS => write!(f, "{m}\tb{r}, f{s}, f{t}"),
            MoveqzS | MovnezS | MovltzS | MovgezS => write!(f, "{m}\tf{r}, f{s}, a{t}"),
            MovfS | MovtS => write!(f, "{m}\tf{r}, f{s}, b{t}"),
            Unknown => write!(f, "{m}"),
        }
    }
}
