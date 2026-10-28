//! Instruction decoder for the ESP32's Xtensa LX6 configuration.
//!
//! Encodings follow the Xtensa ISA Reference Manual. Instructions are 24-bit (op0 0–7) or
//! 16-bit "density" instructions (op0 8–13), little-endian. Field names match the manual:
//!
//! ```text
//!  23   20 19   16 15   12 11    8 7     4 3     0
//! | op2   | op1   |   r   |   s   |   t   |  op0  |   RRR
//! |     imm8      |   r   |   s   |   t   |  op0  |   RRI8
//! |          imm16                |   t   |  op0  |   RI16
//! |            offset18                 | n | op0 |   CALL
//! ```

/// Decoded operation. Operand meaning is documented per group; see [`Insn`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Op {
    // --- ST0 / special -------------------------------------------------------------------
    Ill, Ret, Retw, Jx, Callx0, Callx4, Callx8, Callx12,
    Movsp, Isync, Rsync, Esync, Dsync, Excw, Memw, Extw, Nop,
    Rfe, Rfue, Rfde, Rfwo, Rfwu, Rfi, Rfme,
    Break, Syscall, Simcall, Rsil, Waiti,
    Any4, All4, Any8, All8,
    /// Region-protection TLB access (ESP32 uses 8 × 512 MB regions, no translation).
    Ritlb0, Iitlb, Pitlb, Witlb, Ritlb1, Rdtlb0, Idtlb, Pdtlb, Wdtlb, Rdtlb1,
    // --- Logic / arithmetic ---------------------------------------------------------------
    And, Or, Xor,
    Ssr, Ssl, Ssa8l, Ssa8b, Ssai, Rer, Wer, Rotw, Nsa, Nsau,
    Neg, Abs, Add, Addx2, Addx4, Addx8, Sub, Subx2, Subx4, Subx8,
    Slli, Srai, Srli, Xsr, Src, Srl, Sll, Sra, Mul16u, Mul16s,
    Andb, Andbc, Orb, Orbc, Xorb,
    Mull, Muluh, Mulsh, Quou, Quos, Remu, Rems,
    Rsr, Wsr, Sext, Clamps, Min, Max, Minu, Maxu,
    Moveqz, Movnez, Movltz, Movgez, Movf, Movt, Rur, Wur, Extui,
    // --- Loads / stores ------------------------------------------------------------------
    L32e, S32e, L32r, L8ui, L16ui, L16si, L32i, S8i, S16i, S32i,
    /// Cache operation; `t` (and imm for DCE/ICE) selects which. No effect in the emulator.
    Cache,
    Movi, L32ai, Addi, Addmi, S32c1i, S32ri,
    // --- Calls, jumps, branches ----------------------------------------------------------
    Call0, Call4, Call8, Call12, J, Entry,
    Beqz, Bnez, Bltz, Bgez, Beqi, Bnei, Blti, Bgei, Bltui, Bgeui,
    Bf, Bt, Loop, Loopnez, Loopgtz,
    Bnone, Beq, Blt, Bltu, Ball, Bbc, Bbci, Bany, Bne, Bge, Bgeu, Bnall, Bbs, Bbsi,
    // --- Density (16-bit) ----------------------------------------------------------------
    L32iN, S32iN, AddN, AddiN, MoviN, BeqzN, BnezN, MovN, RetN, RetwN, BreakN, NopN, IllN,
    // --- Single-precision floating point (coprocessor 0) ---------------------------------
    Lsi, Ssi, Lsiu, Ssiu, Lsx, Lsxu, Ssx, Ssxu,
    AddS, SubS, MulS, MaddS, MsubS, RoundS, TruncS, FloorS, CeilS, FloatS, UfloatS, UtruncS,
    MovS, AbsS, Rfr, Wfr, NegS,
    UnS, OeqS, UeqS, OltS, UltS, OleS, UleS,
    MoveqzS, MovnezS, MovltzS, MovgezS, MovfS, MovtS,
    /// Valid encoding space this emulator does not implement (MAC16, TLB, custom ops...).
    Unknown,
}

/// A decoded instruction.
///
/// `r`, `s`, `t` are the raw register fields; `imm` holds the decoded immediate:
/// * branches, J, CALLn, LOOP: target offset **relative to this instruction's PC**
/// * L32R: the negative literal offset (added to `(pc + 3) & !3`)
/// * loads/stores: byte offset; MOVI/ADDI/ADDMI: the constant
/// * RSR/WSR/XSR/RUR/WUR: the special/user register number
/// * shifts: shift amount; EXTUI: shift, with `t2` = mask width
/// * B*I branches: the B4CONST/B4CONSTU value; BBCI/BBSI: bit number
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Insn {
    pub op: Op,
    pub len: u8,
    pub r: u8,
    pub s: u8,
    pub t: u8,
    pub imm: i32,
    /// Second immediate where an instruction has two (EXTUI mask width, branch-immediate offset).
    pub imm2: i32,
    /// Highest address register touched, for the window-overflow check. Filled in by the CPU
    /// when the instruction enters its decode cache.
    pub max_ar: u8,
}

const B4CONST: [i32; 16] = [-1, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 32, 64, 128, 256];
const B4CONSTU: [i32; 16] = [32768, 65536, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 32, 64, 128, 256];

#[inline]
fn sext(value: u32, bits: u32) -> i32 {
    let shift = 32 - bits;
    ((value << shift) as i32) >> shift
}

/// Length in bytes of the instruction whose first byte is `b0`.
#[inline]
pub fn insn_len(b0: u8) -> u8 {
    if b0 & 0x08 != 0 { 2 } else { 3 }
}

/// Decode the instruction in the low bytes of `word` (little-endian, at least 3 valid bytes
/// for 24-bit instructions).
pub fn decode(word: u32) -> Insn {
    // Fetch hands us 4 bytes; the 4th belongs to the next instruction
    let word = word & 0x00ff_ffff;
    let op0 = word & 0xf;
    let t = ((word >> 4) & 0xf) as u8;
    let s = ((word >> 8) & 0xf) as u8;
    let r = ((word >> 12) & 0xf) as u8;
    let op1 = (word >> 16) & 0xf;
    let op2 = (word >> 20) & 0xf;
    let imm8 = (word >> 16) & 0xff;

    let mut i = Insn { op: Op::Unknown, len: insn_len(word as u8), r, s, t, imm: 0, imm2: 0, max_ar: 15 };
    let set = |i: &mut Insn, op: Op, imm: i32| {
        i.op = op;
        i.imm = imm;
    };

    match op0 {
        0 => match op1 {
            0 => match op2 {
                0 => match r {
                    0 => {
                        let m = t >> 2;
                        let n = t & 3;
                        match (m, n) {
                            (0, 0) => i.op = Op::Ill,
                            (2, 0) => i.op = Op::Ret,
                            (2, 1) => i.op = Op::Retw,
                            (2, 2) => i.op = Op::Jx,
                            (3, 0) => i.op = Op::Callx0,
                            (3, 1) => i.op = Op::Callx4,
                            (3, 2) => i.op = Op::Callx8,
                            (3, 3) => i.op = Op::Callx12,
                            _ => {}
                        }
                    }
                    1 => i.op = Op::Movsp,
                    2 => {
                        i.op = match t {
                            0 => Op::Isync,
                            1 => Op::Rsync,
                            2 => Op::Esync,
                            3 => Op::Dsync,
                            8 => Op::Excw,
                            12 => Op::Memw,
                            13 => Op::Extw,
                            15 => Op::Nop,
                            _ => Op::Unknown,
                        }
                    }
                    3 => {
                        i.op = match (t, s) {
                            (0, 0) => Op::Rfe,
                            (0, 1) => Op::Rfue,
                            (0, 2) => Op::Rfde,
                            (0, 4) => Op::Rfwo,
                            (0, 5) => Op::Rfwu,
                            (1, _) => Op::Rfi,
                            (2, 0) => Op::Rfme,
                            _ => Op::Unknown,
                        }
                    }
                    4 => i.op = Op::Break,
                    5 => {
                        i.op = match (s, t) {
                            (0, 0) => Op::Syscall,
                            (1, 0) => Op::Simcall,
                            _ => Op::Unknown,
                        }
                    }
                    6 => i.op = Op::Rsil,
                    7 => i.op = if t == 0 { Op::Waiti } else { Op::Unknown },
                    8 => i.op = Op::Any4,
                    9 => i.op = Op::All4,
                    10 => i.op = Op::Any8,
                    11 => i.op = Op::All8,
                    _ => {}
                },
                1 => i.op = Op::And,
                2 => i.op = Op::Or,
                3 => i.op = Op::Xor,
                4 => match r {
                    0 => i.op = Op::Ssr,
                    1 => i.op = Op::Ssl,
                    2 => i.op = Op::Ssa8l,
                    3 => i.op = Op::Ssa8b,
                    4 => set(&mut i, Op::Ssai, (s as i32) | (((t & 1) as i32) << 4)),
                    6 => i.op = Op::Rer,
                    7 => i.op = Op::Wer,
                    8 => set(&mut i, Op::Rotw, sext(t as u32, 4)),
                    14 => i.op = Op::Nsa,
                    15 => i.op = Op::Nsau,
                    _ => {}
                },
                5 => {
                    i.op = match r {
                        3 => Op::Ritlb0,
                        4 => Op::Iitlb,
                        5 => Op::Pitlb,
                        6 => Op::Witlb,
                        7 => Op::Ritlb1,
                        11 => Op::Rdtlb0,
                        12 => Op::Idtlb,
                        13 => Op::Pdtlb,
                        14 => Op::Wdtlb,
                        15 => Op::Rdtlb1,
                        _ => Op::Unknown,
                    }
                }
                6 => {
                    i.op = match s {
                        0 => Op::Neg,
                        1 => Op::Abs,
                        _ => Op::Unknown,
                    }
                }
                8 => i.op = Op::Add,
                9 => i.op = Op::Addx2,
                10 => i.op = Op::Addx4,
                11 => i.op = Op::Addx8,
                12 => i.op = Op::Sub,
                13 => i.op = Op::Subx2,
                14 => i.op = Op::Subx4,
                15 => i.op = Op::Subx8,
                _ => {}
            },
            1 => match op2 {
                // SLLI encodes 32 − shift
                0 | 1 => set(&mut i, Op::Slli, 32 - ((((op2 & 1) << 4) | t as u32) as i32)),
                2 | 3 => set(&mut i, Op::Srai, (((op2 & 1) << 4) | s as u32) as i32),
                4 => set(&mut i, Op::Srli, s as i32),
                6 => set(&mut i, Op::Xsr, ((r as i32) << 4) | s as i32),
                8 => i.op = Op::Src,
                9 => i.op = if s == 0 { Op::Srl } else { Op::Unknown },
                10 => i.op = if t == 0 { Op::Sll } else { Op::Unknown },
                11 => i.op = if s == 0 { Op::Sra } else { Op::Unknown },
                12 => i.op = Op::Mul16u,
                13 => i.op = Op::Mul16s,
                _ => {}
            },
            2 => {
                i.op = match op2 {
                    0 => Op::Andb,
                    1 => Op::Andbc,
                    2 => Op::Orb,
                    3 => Op::Orbc,
                    4 => Op::Xorb,
                    8 => Op::Mull,
                    10 => Op::Muluh,
                    11 => Op::Mulsh,
                    12 => Op::Quou,
                    13 => Op::Quos,
                    14 => Op::Remu,
                    15 => Op::Rems,
                    _ => Op::Unknown,
                }
            }
            3 => match op2 {
                0 => set(&mut i, Op::Rsr, ((r as i32) << 4) | s as i32),
                1 => set(&mut i, Op::Wsr, ((r as i32) << 4) | s as i32),
                2 => set(&mut i, Op::Sext, t as i32 + 7),
                3 => set(&mut i, Op::Clamps, t as i32 + 7),
                4 => i.op = Op::Min,
                5 => i.op = Op::Max,
                6 => i.op = Op::Minu,
                7 => i.op = Op::Maxu,
                8 => i.op = Op::Moveqz,
                9 => i.op = Op::Movnez,
                10 => i.op = Op::Movltz,
                11 => i.op = Op::Movgez,
                12 => i.op = Op::Movf,
                13 => i.op = Op::Movt,
                14 => set(&mut i, Op::Rur, ((s as i32) << 4) | t as i32),
                15 => set(&mut i, Op::Wur, ((r as i32) << 4) | s as i32),
                _ => {}
            },
            4 | 5 => {
                set(&mut i, Op::Extui, (((op1 & 1) << 4) | s as u32) as i32);
                i.imm2 = op2 as i32 + 1;
            }
            8 => {
                i.op = match op2 {
                    0 => Op::Lsx,
                    1 => Op::Lsxu,
                    4 => Op::Ssx,
                    5 => Op::Ssxu,
                    _ => Op::Unknown,
                }
            }
            9 => match op2 {
                0 => set(&mut i, Op::L32e, ((r as i32) << 2) - 64),
                4 => set(&mut i, Op::S32e, ((r as i32) << 2) - 64),
                _ => {}
            },
            10 => {
                i.op = match op2 {
                    0 => Op::AddS,
                    1 => Op::SubS,
                    2 => Op::MulS,
                    4 => Op::MaddS,
                    5 => Op::MsubS,
                    8 => Op::RoundS,
                    9 => Op::TruncS,
                    10 => Op::FloorS,
                    11 => Op::CeilS,
                    12 => Op::FloatS,
                    13 => Op::UfloatS,
                    14 => Op::UtruncS,
                    15 => match t {
                        0 => Op::MovS,
                        1 => Op::AbsS,
                        4 => Op::Rfr,
                        5 => Op::Wfr,
                        6 => Op::NegS,
                        _ => Op::Unknown,
                    },
                    _ => Op::Unknown,
                };
                i.imm = t as i32;
            }
            11 => {
                i.op = match op2 {
                    1 => Op::UnS,
                    2 => Op::OeqS,
                    3 => Op::UeqS,
                    4 => Op::OltS,
                    5 => Op::UltS,
                    6 => Op::OleS,
                    7 => Op::UleS,
                    8 => Op::MoveqzS,
                    9 => Op::MovnezS,
                    10 => Op::MovltzS,
                    11 => Op::MovgezS,
                    12 => Op::MovfS,
                    13 => Op::MovtS,
                    _ => Op::Unknown,
                }
            }
            _ => {}
        },
        1 => set(&mut i, Op::L32r, (0xfffc_0000 | ((word >> 8) << 2)) as i32),
        2 => match r {
            0 => set(&mut i, Op::L8ui, imm8 as i32),
            1 => set(&mut i, Op::L16ui, (imm8 << 1) as i32),
            2 => set(&mut i, Op::L32i, (imm8 << 2) as i32),
            4 => set(&mut i, Op::S8i, imm8 as i32),
            5 => set(&mut i, Op::S16i, (imm8 << 1) as i32),
            6 => set(&mut i, Op::S32i, (imm8 << 2) as i32),
            7 => {
                // DCE/ICE group: sub-op in imm8[7:4], offset imm4 scaled by 16
                if t == 8 || t == 13 {
                    i.imm2 = (imm8 >> 4) as i32;
                    set(&mut i, Op::Cache, ((imm8 & 0xf) << 4) as i32);
                } else {
                    set(&mut i, Op::Cache, (imm8 << 2) as i32);
                }
            }
            9 => set(&mut i, Op::L16si, (imm8 << 1) as i32),
            10 => set(&mut i, Op::Movi, sext(((s as u32) << 8) | imm8, 12)),
            11 => set(&mut i, Op::L32ai, (imm8 << 2) as i32),
            12 => set(&mut i, Op::Addi, sext(imm8, 8)),
            13 => set(&mut i, Op::Addmi, sext(imm8, 8) << 8),
            14 => set(&mut i, Op::S32c1i, (imm8 << 2) as i32),
            15 => set(&mut i, Op::S32ri, (imm8 << 2) as i32),
            _ => {}
        },
        3 => match r {
            0 => set(&mut i, Op::Lsi, (imm8 << 2) as i32),
            4 => set(&mut i, Op::Ssi, (imm8 << 2) as i32),
            8 => set(&mut i, Op::Lsiu, (imm8 << 2) as i32),
            12 => set(&mut i, Op::Ssiu, (imm8 << 2) as i32),
            _ => {}
        },
        5 => {
            let offset = sext(word >> 6, 18) << 2;
            // Target = (PC & ~3) + offset + 4; stored relative to PC, so the PC's low bits are
            // subtracted at execution time (see Cpu::call_target).
            let op = [Op::Call0, Op::Call4, Op::Call8, Op::Call12][(t & 3) as usize];
            set(&mut i, op, offset + 4);
        }
        6 => {
            let n = t & 3;
            let m = t >> 2;
            match n {
                0 => set(&mut i, Op::J, sext(word >> 6, 18) + 4),
                1 => {
                    let op = [Op::Beqz, Op::Bnez, Op::Bltz, Op::Bgez][m as usize];
                    set(&mut i, op, sext(word >> 12, 12) + 4);
                }
                2 => {
                    let op = [Op::Beqi, Op::Bnei, Op::Blti, Op::Bgei][m as usize];
                    set(&mut i, op, B4CONST[r as usize]);
                    i.imm2 = sext(imm8, 8) + 4;
                }
                _ => match m {
                    0 => set(&mut i, Op::Entry, ((word >> 12) << 3) as i32),
                    1 => match r {
                        0 => set(&mut i, Op::Bf, sext(imm8, 8) + 4),
                        1 => set(&mut i, Op::Bt, sext(imm8, 8) + 4),
                        // LOOP offsets are unsigned: LEND is always after the loop instruction
                        8 => set(&mut i, Op::Loop, imm8 as i32 + 4),
                        9 => set(&mut i, Op::Loopnez, imm8 as i32 + 4),
                        10 => set(&mut i, Op::Loopgtz, imm8 as i32 + 4),
                        _ => {}
                    },
                    _ => {
                        let op = if m == 2 { Op::Bltui } else { Op::Bgeui };
                        set(&mut i, op, B4CONSTU[r as usize]);
                        i.imm2 = sext(imm8, 8) + 4;
                    }
                },
            }
        }
        7 => {
            let target = sext(imm8, 8) + 4;
            match r {
                0 => set(&mut i, Op::Bnone, target),
                1 => set(&mut i, Op::Beq, target),
                2 => set(&mut i, Op::Blt, target),
                3 => set(&mut i, Op::Bltu, target),
                4 => set(&mut i, Op::Ball, target),
                5 => set(&mut i, Op::Bbc, target),
                6 | 7 => {
                    set(&mut i, Op::Bbci, (((r & 1) as i32) << 4) | t as i32);
                    i.imm2 = target;
                }
                8 => set(&mut i, Op::Bany, target),
                9 => set(&mut i, Op::Bne, target),
                10 => set(&mut i, Op::Bge, target),
                11 => set(&mut i, Op::Bgeu, target),
                12 => set(&mut i, Op::Bnall, target),
                13 => set(&mut i, Op::Bbs, target),
                _ => {
                    set(&mut i, Op::Bbsi, (((r & 1) as i32) << 4) | t as i32);
                    i.imm2 = target;
                }
            }
        }
        8 => set(&mut i, Op::L32iN, (r as i32) << 2),
        9 => set(&mut i, Op::S32iN, (r as i32) << 2),
        10 => i.op = Op::AddN,
        11 => set(&mut i, Op::AddiN, if t == 0 { -1 } else { t as i32 }),
        12 => {
            if t & 8 == 0 {
                // imm7 = {t[2:0], r}, range −32..95
                let v = (((t & 7) as i32) << 4) | r as i32;
                set(&mut i, Op::MoviN, if v >= 96 { v - 128 } else { v });
            } else {
                let offset = ((((t & 3) as i32) << 4) | r as i32) + 4;
                set(&mut i, if t & 4 == 0 { Op::BeqzN } else { Op::BnezN }, offset);
            }
        }
        13 => match r {
            0 => i.op = Op::MovN,
            15 => {
                i.op = match t {
                    0 => Op::RetN,
                    1 => Op::RetwN,
                    2 => Op::BreakN,
                    3 => Op::NopN,
                    6 => Op::IllN,
                    _ => Op::Unknown,
                }
            }
            _ => {}
        },
        _ => {}
    }
    i
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(bytes: &[u8]) -> Insn {
        let mut w = 0u32;
        for (k, b) in bytes.iter().enumerate() {
            w |= (*b as u32) << (8 * k);
        }
        decode(w)
    }

    // Byte patterns taken from objdump of the lesson 01 firmware
    #[test]
    fn known_encodings() {
        assert_eq!(d(&[0x36, 0x21, 0x00]).op, Op::Entry); // entry a1, 16
        assert_eq!(d(&[0x36, 0x21, 0x00]).imm, 16);
        let movi_n = d(&[0x0c, 0x20]);
        assert_eq!((movi_n.op, movi_n.s, movi_n.imm, movi_n.len), (Op::MoviN, 0, 2, 2));
        let extui = d(&[0x20, 0x38, 0x34]); // extui a3, a2, 8, 4
        assert_eq!((extui.op, extui.r, extui.t, extui.imm, extui.imm2), (Op::Extui, 3, 2, 8, 4));
        let slli = d(&[0x80, 0x33, 0x11]); // slli a3, a3, 8
        assert_eq!((slli.op, slli.imm), (Op::Slli, 8));
        let l32e = d(&[0x00, 0xc5, 0x09]); // l32e a0, a5, -16
        assert_eq!((l32e.op, l32e.imm), (Op::L32e, -16));
        assert_eq!(d(&[0xf0, 0x80, 0x40]).imm, -1); // rotw -1
        let rsil = d(&[0x60, 0x63, 0x00]); // rsil a6, 3
        assert_eq!((rsil.op, rsil.t, rsil.s), (Op::Rsil, 6, 3));
    }
}
