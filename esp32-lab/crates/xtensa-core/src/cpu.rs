//! Architectural state and instruction execution for one ESP32 Xtensa LX6 core.
//!
//! Configuration (ESP32 core-isa.h): windowed ABI with 64 physical AR registers, density, zero-
//! overhead loops, MUL16/MUL32/DIV32, NSA, MIN/MAX, SEXT, CLAMPS, booleans, S32C1I, THREADPTR,
//! single-precision FPU (coprocessor 0), 32 interrupts on 7 levels (EXCMLEVEL 3), 3 CCOMPARE
//! timers, relocatable vectors, unaligned accesses raise an exception.

use crate::bus::{Bus, BusError};
use crate::decode::{decode, Insn, Op};

// --- Exception causes (EXCCAUSE) -----------------------------------------------------------
pub const EXC_ILLEGAL: u32 = 0;
pub const EXC_SYSCALL: u32 = 1;
pub const EXC_INSTR_FETCH_ERROR: u32 = 2;
pub const EXC_LOAD_STORE_ERROR: u32 = 3;
pub const EXC_LEVEL1_INTERRUPT: u32 = 4;
pub const EXC_ALLOCA: u32 = 5;
pub const EXC_DIVIDE_BY_ZERO: u32 = 6;
pub const EXC_LOAD_STORE_ALIGNMENT: u32 = 9;
pub const EXC_INSTR_PIF_ADDR_ERROR: u32 = 14;
pub const EXC_LOAD_STORE_PIF_ADDR_ERROR: u32 = 15;
pub const EXC_COPROCESSOR0_DISABLED: u32 = 32;

// --- Vector offsets from VECBASE -----------------------------------------------------------
const VEC_WINDOW_OVERFLOW4: u32 = 0x000;
const VEC_WINDOW_UNDERFLOW4: u32 = 0x040;
const VEC_WINDOW_OVERFLOW8: u32 = 0x080;
const VEC_WINDOW_UNDERFLOW8: u32 = 0x0c0;
const VEC_WINDOW_OVERFLOW12: u32 = 0x100;
const VEC_WINDOW_UNDERFLOW12: u32 = 0x140;
/// Level 2..7 interrupt vectors (index = level); level 6 is Debug, level 7 NMI.
const VEC_INTERRUPT: [u32; 8] = [0, 0, 0x180, 0x1c0, 0x200, 0x240, 0x280, 0x2c0];
const VEC_KERNEL: u32 = 0x300;
const VEC_USER: u32 = 0x340;
const VEC_DOUBLE: u32 = 0x3c0;

// --- PS fields ------------------------------------------------------------------------------
pub const PS_INTLEVEL: u32 = 0xf;
pub const PS_EXCM: u32 = 1 << 4;
pub const PS_UM: u32 = 1 << 5;
pub const PS_OWB_SHIFT: u32 = 8;
pub const PS_OWB: u32 = 0xf << PS_OWB_SHIFT;
pub const PS_CALLINC_SHIFT: u32 = 16;
pub const PS_CALLINC: u32 = 3 << PS_CALLINC_SHIFT;
pub const PS_WOE: u32 = 1 << 18;
const PS_MASK: u32 = 0x0007_0fff;

const EXCM_LEVEL: u32 = 3;
const ICACHE_SIZE: usize = 1 << 15;

/// Interrupt level of each of the 32 CPU interrupts (ESP32 TRM, "CPU interrupts" table).
pub const INT_LEVEL: [u8; 32] = [
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 1, 1, 7, 3, //
    5, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 3, 4, 3, 4, 5,
];
/// Software interrupts (settable through INTSET).
pub const INT_SOFTWARE: u32 = (1 << 7) | (1 << 29);
/// Edge-triggered external interrupts (latched, cleared through INTCLEAR).
pub const INT_EDGE: u32 = (1 << 10) | (1 << 22) | (1 << 28) | (1 << 30);
/// CCOMPARE0..2 raise these interrupts.
pub const INT_TIMER: [u32; 3] = [6, 15, 16];

// --- Special register numbers ----------------------------------------------------------------
mod sr {
    pub const LBEG: u32 = 0;
    pub const LEND: u32 = 1;
    pub const LCOUNT: u32 = 2;
    pub const SAR: u32 = 3;
    pub const BR: u32 = 4;
    pub const LITBASE: u32 = 5;
    pub const SCOMPARE1: u32 = 12;
    pub const WINDOWBASE: u32 = 72;
    pub const WINDOWSTART: u32 = 73;
    pub const EPC1: u32 = 177;
    pub const EPC7: u32 = 183;
    pub const DEPC: u32 = 192;
    pub const EPS2: u32 = 194;
    pub const EPS7: u32 = 199;
    pub const EXCSAVE1: u32 = 209;
    pub const EXCSAVE7: u32 = 215;
    pub const CPENABLE: u32 = 224;
    pub const INTERRUPT: u32 = 226;
    pub const INTCLEAR: u32 = 227;
    pub const INTENABLE: u32 = 228;
    pub const PS: u32 = 230;
    pub const VECBASE: u32 = 231;
    pub const EXCCAUSE: u32 = 232;
    pub const CCOUNT: u32 = 234;
    pub const PRID: u32 = 235;
    pub const EXCVADDR: u32 = 238;
    pub const CCOMPARE0: u32 = 240;
    pub const CCOMPARE2: u32 = 242;
}

mod ur {
    pub const THREADPTR: u32 = 231;
    pub const FCR: u32 = 232;
    pub const FSR: u32 = 233;
}

/// What happened in one [`Cpu::step`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// One instruction retired (or an exception/interrupt was taken and the PC vectored).
    Ok,
    /// Sleeping in WAITI until an interrupt above the current level arrives.
    Waiting,
    /// BREAK / BREAK.N with no debugger attached. PC still points at the instruction.
    Break { s: u8, t: u8 },
    /// An exception was taken; reported so a runner can stop on unexpected ones.
    Exception { cause: u32, pc: u32 },
}

#[derive(Clone)]
pub struct Cpu {
    pub pc: u32,
    /// Physical address registers; `a(n)` is `ar[(windowbase * 4 + n) % 64]`.
    pub ar: [u32; 64],
    pub windowbase: u32,
    pub windowstart: u32,
    pub ps: u32,
    pub sar: u32,
    pub lbeg: u32,
    pub lend: u32,
    pub lcount: u32,
    pub br: u32,
    pub litbase: u32,
    pub scompare1: u32,
    pub epc: [u32; 8],
    pub eps: [u32; 8],
    pub excsave: [u32; 8],
    pub depc: u32,
    pub exccause: u32,
    pub excvaddr: u32,
    pub vecbase: u32,
    pub cpenable: u32,
    pub ccount: u32,
    pub ccompare: [u32; 3],
    pub intenable: u32,
    /// Latched interrupt bits: software, edge and timer interrupts.
    pub interrupt: u32,
    /// Level-triggered external interrupt lines, driven by the interrupt matrix.
    pub irq_lines: u32,
    pub prid: u32,
    pub threadptr: u32,
    pub fcr: u32,
    pub fsr: u32,
    pub f: [u32; 16],
    /// Every other special/user register, stored but without side effects.
    pub sr_other: [u32; 256],
    pub ur_other: [u32; 256],
    /// Region protection attributes for the eight 512 MB regions (instruction, data).
    pub itlb_attr: [u32; 8],
    pub dtlb_attr: [u32; 8],
    pub waiting: bool,
    /// Decoded-instruction cache, direct-mapped by PC: (pc + 1, insn); 0 marks an empty slot.
    icache: Vec<(u32, Insn)>,
    icache_generation: u64,
    /// Instructions retired (≈ cycles; the timing model is 1 cycle per instruction for now).
    pub retired: u64,
}

impl Cpu {
    /// Reset state. `prid` is 0xCDCD for PRO_CPU and 0xABAB for APP_CPU on the ESP32.
    pub fn new(reset_pc: u32, prid: u32) -> Self {
        Self {
            pc: reset_pc,
            ar: [0; 64],
            windowbase: 0,
            windowstart: 1,
            // Reset: INTLEVEL 15, EXCM 0... the ISA specifies PS = 0x1F at reset
            ps: 0x1f,
            sar: 0,
            lbeg: 0,
            lend: 0,
            lcount: 0,
            br: 0,
            litbase: 0,
            scompare1: 0,
            epc: [0; 8],
            eps: [0; 8],
            excsave: [0; 8],
            depc: 0,
            exccause: 0,
            excvaddr: 0,
            vecbase: 0x4000_0000,
            cpenable: 0,
            ccount: 0,
            ccompare: [0; 3],
            intenable: 0,
            interrupt: 0,
            irq_lines: 0,
            prid,
            threadptr: 0,
            fcr: 0,
            fsr: 0,
            f: [0; 16],
            sr_other: [0; 256],
            ur_other: [0; 256],
            // Reset: every region is "bypass" (attribute 2), i.e. accessible
            itlb_attr: [2; 8],
            dtlb_attr: [2; 8],
            waiting: false,
            icache: vec![(0, decode(0)); ICACHE_SIZE],
            icache_generation: 0,
            retired: 0,
        }
    }

    // ------------------------------------------------------------------------------------
    // Registers
    // ------------------------------------------------------------------------------------

    #[inline]
    fn phys(&self, n: u8) -> usize {
        ((self.windowbase as usize * 4) + n as usize) & 63
    }

    /// Logical address register `a<n>` in the current window.
    #[inline]
    pub fn a(&self, n: u8) -> u32 {
        self.ar[self.phys(n)]
    }

    #[inline]
    pub fn set_a(&mut self, n: u8, v: u32) {
        let p = self.phys(n);
        self.ar[p] = v;
    }

    fn b(&self, n: u8) -> bool {
        self.br & (1 << n) != 0
    }

    fn set_b(&mut self, n: u8, v: bool) {
        if v { self.br |= 1 << n } else { self.br &= !(1 << n) }
    }

    fn fs(&self, n: u8) -> f32 {
        f32::from_bits(self.f[n as usize])
    }

    fn set_fs(&mut self, n: u8, v: f32) {
        self.f[n as usize] = v.to_bits();
    }

    fn excm(&self) -> bool {
        self.ps & PS_EXCM != 0
    }

    /// Window overflow checking is active (PS.WOE set and not in an exception handler).
    fn cwoe(&self) -> bool {
        self.ps & PS_WOE != 0 && !self.excm()
    }

    fn rotate_window(&mut self, delta: i32) {
        self.windowbase = (self.windowbase as i32 + delta).rem_euclid(16) as u32;
    }

    pub fn read_sr(&self, n: u32) -> u32 {
        match n {
            sr::LBEG => self.lbeg,
            sr::LEND => self.lend,
            sr::LCOUNT => self.lcount,
            sr::SAR => self.sar,
            sr::BR => self.br,
            sr::LITBASE => self.litbase,
            sr::SCOMPARE1 => self.scompare1,
            sr::WINDOWBASE => self.windowbase,
            sr::WINDOWSTART => self.windowstart,
            sr::EPC1..=sr::EPC7 => self.epc[(n - sr::EPC1 + 1) as usize],
            sr::DEPC => self.depc,
            sr::EPS2..=sr::EPS7 => self.eps[(n - sr::EPS2 + 2) as usize],
            sr::EXCSAVE1..=sr::EXCSAVE7 => self.excsave[(n - sr::EXCSAVE1 + 1) as usize],
            sr::CPENABLE => self.cpenable,
            sr::INTERRUPT => self.interrupt | self.irq_lines,
            sr::INTENABLE => self.intenable,
            sr::PS => self.ps,
            sr::VECBASE => self.vecbase,
            sr::EXCCAUSE => self.exccause,
            sr::CCOUNT => self.ccount,
            sr::PRID => self.prid,
            sr::EXCVADDR => self.excvaddr,
            sr::CCOMPARE0..=sr::CCOMPARE2 => self.ccompare[(n - sr::CCOMPARE0) as usize],
            _ => self.sr_other[n as usize & 255],
        }
    }

    pub fn write_sr(&mut self, n: u32, v: u32) {
        match n {
            sr::LBEG => self.lbeg = v,
            sr::LEND => self.lend = v,
            sr::LCOUNT => self.lcount = v,
            sr::SAR => self.sar = v & 0x3f,
            sr::BR => self.br = v & 0xffff,
            sr::LITBASE => self.litbase = v & 0xffff_f001,
            sr::SCOMPARE1 => self.scompare1 = v,
            sr::WINDOWBASE => self.windowbase = v & 0xf,
            sr::WINDOWSTART => self.windowstart = v & 0xffff,
            sr::EPC1..=sr::EPC7 => self.epc[(n - sr::EPC1 + 1) as usize] = v,
            sr::DEPC => self.depc = v,
            sr::EPS2..=sr::EPS7 => self.eps[(n - sr::EPS2 + 2) as usize] = v,
            sr::EXCSAVE1..=sr::EXCSAVE7 => self.excsave[(n - sr::EXCSAVE1 + 1) as usize] = v,
            sr::CPENABLE => self.cpenable = v & 0xff,
            // Writing INTERRUPT is INTSET: only software interrupts can be raised this way
            sr::INTERRUPT => self.interrupt |= v & INT_SOFTWARE,
            sr::INTCLEAR => self.interrupt &= !(v & (INT_SOFTWARE | INT_EDGE)),
            sr::INTENABLE => self.intenable = v,
            sr::PS => self.ps = v & PS_MASK,
            sr::VECBASE => self.vecbase = v & !0x3ff,
            sr::EXCCAUSE => self.exccause = v & 0x3f,
            sr::CCOUNT => self.ccount = v,
            sr::PRID => {}
            sr::EXCVADDR => self.excvaddr = v,
            sr::CCOMPARE0..=sr::CCOMPARE2 => {
                let k = (n - sr::CCOMPARE0) as usize;
                self.ccompare[k] = v;
                // Writing CCOMPAREn acknowledges its timer interrupt
                self.interrupt &= !(1 << INT_TIMER[k]);
            }
            _ => self.sr_other[n as usize & 255] = v,
        }
    }

    fn read_ur(&self, n: u32) -> u32 {
        match n {
            ur::THREADPTR => self.threadptr,
            ur::FCR => self.fcr,
            ur::FSR => self.fsr,
            _ => self.ur_other[n as usize & 255],
        }
    }

    fn write_ur(&mut self, n: u32, v: u32) {
        match n {
            ur::THREADPTR => self.threadptr = v,
            ur::FCR => self.fcr = v,
            ur::FSR => self.fsr = v,
            _ => self.ur_other[n as usize & 255] = v,
        }
    }

    // ------------------------------------------------------------------------------------
    // Time and interrupts
    // ------------------------------------------------------------------------------------

    /// Advance CCOUNT, raising CCOMPARE interrupts the count passes.
    pub fn tick(&mut self, cycles: u32) {
        let old = self.ccount;
        for k in 0..3 {
            // Fires when CCOUNT becomes equal to CCOMPARE, i.e. CCOMPARE ∈ (old, old + cycles]
            if self.ccompare[k].wrapping_sub(old).wrapping_sub(1) < cycles {
                self.interrupt |= 1 << INT_TIMER[k];
            }
        }
        self.ccount = old.wrapping_add(cycles);
    }

    /// Latch an edge-triggered interrupt.
    pub fn raise_edge(&mut self, n: u32) {
        self.interrupt |= 1 << n;
    }

    /// Cycles until the next CCOMPARE match, for fast-forwarding through WAITI.
    pub fn cycles_to_next_timer(&self) -> u32 {
        (0..3)
            .filter(|&k| self.intenable & (1 << INT_TIMER[k]) != 0)
            .map(|k| self.ccompare[k].wrapping_sub(self.ccount).max(1))
            .min()
            .unwrap_or(u32::MAX)
    }

    /// An enabled interrupt is pending above the current level: the next step will take it.
    pub fn interrupt_ready(&self) -> bool {
        self.pending_interrupt_level() > 0
    }

    /// Highest pending, enabled interrupt level above the current one.
    fn pending_interrupt_level(&self) -> u32 {
        let pending = (self.interrupt | self.irq_lines) & self.intenable;
        if pending == 0 {
            return 0;
        }
        let mut level = 0;
        for n in 0..32 {
            if pending & (1 << n) != 0 {
                level = level.max(INT_LEVEL[n] as u32);
            }
        }
        let current = if self.excm() { (self.ps & PS_INTLEVEL).max(EXCM_LEVEL) } else { self.ps & PS_INTLEVEL };
        if level > current { level } else { 0 }
    }

    fn take_interrupt(&mut self, level: u32) {
        self.waiting = false;
        if level == 1 {
            self.exception(EXC_LEVEL1_INTERRUPT, self.pc);
        } else {
            self.epc[level as usize] = self.pc;
            self.eps[level as usize] = self.ps;
            self.ps = (self.ps & !PS_INTLEVEL) | level | PS_EXCM;
            self.pc = self.vecbase.wrapping_add(VEC_INTERRUPT[level as usize]);
        }
    }

    // ------------------------------------------------------------------------------------
    // Exceptions
    // ------------------------------------------------------------------------------------

    /// General (level-1) exception, or a double exception if already in a handler.
    pub fn exception(&mut self, cause: u32, pc: u32) {
        self.exccause = cause;
        if self.excm() {
            self.depc = pc;
            self.pc = self.vecbase.wrapping_add(VEC_DOUBLE);
        } else {
            self.epc[1] = pc;
            self.ps |= PS_EXCM;
            let vec = if self.ps & PS_UM != 0 { VEC_USER } else { VEC_KERNEL };
            self.pc = self.vecbase.wrapping_add(vec);
        }
    }

    fn memory_exception(&mut self, err: BusError, addr: u32, pc: u32) -> u32 {
        self.excvaddr = addr;
        let cause = match err {
            BusError::Unmapped => EXC_LOAD_STORE_PIF_ADDR_ERROR,
            BusError::BadWidth => EXC_LOAD_STORE_ERROR,
        };
        self.exception(cause, pc);
        cause
    }

    /// Window overflow check before an instruction that uses address registers up to `max_reg`.
    /// Returns true if an overflow exception was raised instead of executing the instruction.
    fn window_check(&mut self, pc: u32, max_reg: u8) -> bool {
        let w = (max_reg / 4) as u32;
        if w == 0 || !self.cwoe() {
            return false;
        }
        let ws = self.windowstart | (self.windowstart << 16);
        let above = ws >> (self.windowbase + 1);
        let free = above.trailing_zeros();
        if w <= free {
            return false;
        }
        // The frame `n` windows up is live: rotate to it and let the handler spill it
        let n = free + 1;
        let owb = self.windowbase;
        let size = (above >> n).trailing_zeros();
        self.rotate_window(n as i32);
        self.ps = (self.ps & !PS_OWB) | (owb << PS_OWB_SHIFT) | PS_EXCM;
        self.epc[1] = pc;
        let vec = match size {
            0 => VEC_WINDOW_OVERFLOW4,
            1 => VEC_WINDOW_OVERFLOW8,
            _ => VEC_WINDOW_OVERFLOW12,
        };
        self.pc = self.vecbase.wrapping_add(vec);
        true
    }

    // ------------------------------------------------------------------------------------
    // Memory
    // ------------------------------------------------------------------------------------

    fn load<B: Bus>(&mut self, bus: &mut B, addr: u32, size: u8, pc: u32) -> Option<u32> {
        if addr & (size as u32 - 1) != 0 {
            self.excvaddr = addr;
            self.exception(EXC_LOAD_STORE_ALIGNMENT, pc);
            return None;
        }
        match bus.read(addr, size) {
            Ok(v) => Some(v),
            Err(e) => {
                self.memory_exception(e, addr, pc);
                None
            }
        }
    }

    fn store<B: Bus>(&mut self, bus: &mut B, addr: u32, size: u8, value: u32, pc: u32) -> bool {
        if addr & (size as u32 - 1) != 0 {
            self.excvaddr = addr;
            self.exception(EXC_LOAD_STORE_ALIGNMENT, pc);
            return false;
        }
        match bus.write(addr, size, value) {
            Ok(()) => true,
            Err(e) => {
                self.memory_exception(e, addr, pc);
                false
            }
        }
    }

    // ------------------------------------------------------------------------------------
    // Execution
    // ------------------------------------------------------------------------------------

    /// Highest address-register index the instruction touches, for the window check.
    /// Over-estimating is safe (at worst an early spill); under-estimating is not.
    pub fn max_ar(i: &Insn) -> u8 {
        use Op::*;
        let (r, s, t) = (i.r, i.s, i.t);
        match i.op {
            And | Or | Xor | Add | Addx2 | Addx4 | Addx8 | Sub | Subx2 | Subx4 | Subx8 | Src | Mul16u | Mul16s
            | Mull | Muluh | Mulsh | Quou | Quos | Remu | Rems | Min | Max | Minu | Maxu | Moveqz | Movnez
            | Movltz | Movgez | AddN => r.max(s).max(t),
            Movf | Movt | Sll | Sext | Clamps | Slli | AddiN => r.max(s),
            Neg | Abs | Srl | Sra | Srai | Srli | Extui => r.max(t),
            Ritlb0 | Pitlb | Witlb | Ritlb1 | Rdtlb0 | Pdtlb | Wdtlb | Rdtlb1 => s.max(t),
            Iitlb | Idtlb => s,
            Movsp | Nsa | Nsau | MovN | Rer | Wer | L32e | S32e | L8ui | L16ui | L16si | L32i | S8i | S16i
            | S32i | L32ai | S32ri | S32c1i | Addi | Addmi | L32iN | S32iN | Bnone | Beq | Blt | Bltu | Ball
            | Bbc | Bany | Bne | Bge | Bgeu | Bnall | Bbs => s.max(t),
            Jx | Ssr | Ssl | Ssa8l | Ssa8b | Beqz | Bnez | Bltz | Bgez | Beqi | Bnei | Blti | Bgei | Bltui
            | Bgeui | Bbci | Bbsi | Loop | Loopnez | Loopgtz | BeqzN | BnezN | MoviN | Entry | Cache | Lsi
            | Ssi | Lsiu | Ssiu | FloatS | UfloatS | Wfr => s,
            Callx0 => s,
            Callx4 => s.max(4),
            Callx8 => s.max(8),
            Callx12 => s.max(12),
            Call4 => 4,
            Call8 => 8,
            Call12 => 12,
            L32r | Movi | Rsil | Rsr | Wsr | Xsr | Wur | MoveqzS | MovnezS | MovltzS | MovgezS => t,
            Lsx | Lsxu | Ssx | Ssxu => s.max(t),
            Rur | RoundS | TruncS | FloorS | CeilS | UtruncS | Rfr => r,
            _ => 0,
        }
    }

    fn is_fp(op: Op) -> bool {
        use Op::*;
        matches!(
            op,
            Lsi | Ssi | Lsiu | Ssiu | Lsx | Lsxu | Ssx | Ssxu | AddS | SubS | MulS | MaddS | MsubS | RoundS
                | TruncS | FloorS | CeilS | FloatS | UfloatS | UtruncS | MovS | AbsS | Rfr | Wfr | NegS | UnS
                | OeqS | UeqS | OltS | UltS | OleS | UleS | MoveqzS | MovnezS | MovltzS | MovgezS | MovfS | MovtS
        )
    }

    /// Execute one instruction (or take one interrupt/exception).
    pub fn step<B: Bus>(&mut self, bus: &mut B) -> Step {
        let level = self.pending_interrupt_level();
        if level > 0 {
            self.take_interrupt(level);
            return Step::Ok;
        }
        if self.waiting {
            return Step::Waiting;
        }

        let pc = self.pc;
        let generation = bus.code_generation();
        if generation != self.icache_generation {
            self.icache.iter_mut().for_each(|e| e.0 = 0);
            self.icache_generation = generation;
        }
        let slot = (pc as usize >> 1) & (ICACHE_SIZE - 1);
        let insn = if self.icache[slot].0 == pc.wrapping_add(1) {
            self.icache[slot].1
        } else {
            let word = match bus.fetch(pc) {
                Ok(w) => w,
                Err(_) => {
                    self.excvaddr = pc;
                    self.exception(EXC_INSTR_PIF_ADDR_ERROR, pc);
                    return Step::Exception { cause: EXC_INSTR_PIF_ADDR_ERROR, pc };
                }
            };
            let mut insn = decode(word);
            insn.max_ar = Self::max_ar(&insn);
            self.icache[slot] = (pc.wrapping_add(1), insn);
            insn
        };
        self.retired += 1;
        self.tick(1);

        if self.window_check(pc, insn.max_ar) {
            return Step::Ok;
        }
        if Self::is_fp(insn.op) && self.cpenable & 1 == 0 {
            self.exception(EXC_COPROCESSOR0_DISABLED, pc);
            return Step::Exception { cause: EXC_COPROCESSOR0_DISABLED, pc };
        }
        self.execute(bus, &insn, pc)
    }

    fn execute<B: Bus>(&mut self, bus: &mut B, i: &Insn, pc: u32) -> Step {
        use Op::*;
        let (r, s, t) = (i.r, i.s, i.t);
        let next = pc.wrapping_add(i.len as u32);
        let rel = |off: i32| pc.wrapping_add(off as u32);
        // Taken branches set `jump`; sequential flow goes through the zero-overhead loop check
        let mut jump: Option<u32> = None;

        macro_rules! raise {
            ($cause:expr) => {{
                self.exception($cause, pc);
                return Step::Exception { cause: $cause, pc };
            }};
        }
        macro_rules! ld {
            ($addr:expr, $size:expr) => {
                match self.load(bus, $addr, $size, pc) {
                    Some(v) => v,
                    None => return Step::Exception { cause: self.exccause, pc },
                }
            };
        }
        macro_rules! st {
            ($addr:expr, $size:expr, $v:expr) => {
                if !self.store(bus, $addr, $size, $v, pc) {
                    return Step::Exception { cause: self.exccause, pc };
                }
            };
        }
        macro_rules! branch {
            ($cond:expr, $off:expr) => {
                if $cond {
                    jump = Some(rel($off));
                }
            };
        }

        match i.op {
            // --- Control ------------------------------------------------------------------
            Ill | IllN | Unknown => raise!(EXC_ILLEGAL),
            Nop | NopN | Isync | Rsync | Esync | Dsync | Excw | Memw | Extw | Cache | Simcall => {}
            Break | BreakN => return Step::Break { s, t },
            Syscall => raise!(EXC_SYSCALL),
            Ret | RetN => jump = Some(self.a(0)),
            Jx => jump = Some(self.a(s)),
            Callx0 => {
                let target = self.a(s);
                self.set_a(0, next);
                jump = Some(target);
            }
            Call0 => {
                self.set_a(0, next);
                jump = Some(self.call_target(pc, i.imm));
            }
            Call4 | Call8 | Call12 | Callx4 | Callx8 | Callx12 => {
                let n: u32 = match i.op {
                    Call4 | Callx4 => 1,
                    Call8 | Callx8 => 2,
                    _ => 3,
                };
                let target = match i.op {
                    Call4 | Call8 | Call12 => self.call_target(pc, i.imm),
                    _ => self.a(s),
                };
                self.set_a((n * 4) as u8, (n << 30) | (next & 0x3fff_ffff));
                self.ps = (self.ps & !PS_CALLINC) | (n << PS_CALLINC_SHIFT);
                jump = Some(target);
            }
            Entry => {
                let callinc = (self.ps & PS_CALLINC) >> PS_CALLINC_SHIFT;
                let sp = self.a(s).wrapping_sub(i.imm as u32);
                self.set_a(((callinc << 2) as u8) | (s & 3), sp);
                self.rotate_window(callinc as i32);
                self.windowstart |= 1 << self.windowbase;
            }
            Retw | RetwN => {
                let n = self.a(0) >> 30;
                if n == 0 {
                    raise!(EXC_ILLEGAL);
                }
                let target = (pc & 0xc000_0000) | (self.a(0) & 0x3fff_ffff);
                let owb = self.windowbase;
                self.rotate_window(-(n as i32));
                if self.windowstart & (1 << self.windowbase) != 0 {
                    self.windowstart &= !(1 << owb);
                    jump = Some(target);
                } else {
                    // The caller's frame was spilled: underflow handler reloads it, then the
                    // RETW is executed again
                    self.ps = (self.ps & !PS_OWB) | (owb << PS_OWB_SHIFT) | PS_EXCM;
                    self.epc[1] = pc;
                    let vec = match n {
                        1 => VEC_WINDOW_UNDERFLOW4,
                        2 => VEC_WINDOW_UNDERFLOW8,
                        _ => VEC_WINDOW_UNDERFLOW12,
                    };
                    self.pc = self.vecbase.wrapping_add(vec);
                    return Step::Ok;
                }
            }
            Movsp => {
                let below = (self.windowstart | (self.windowstart << 16)) >> ((self.windowbase + 13) & 15);
                if below & 7 == 0 {
                    raise!(EXC_ALLOCA);
                }
                self.set_a(t, self.a(s));
            }
            Rotw => self.rotate_window(i.imm),
            Rfe | Rfue => {
                self.ps &= !PS_EXCM;
                jump = Some(self.epc[1]);
            }
            Rfde => {
                self.ps &= !PS_EXCM;
                jump = Some(self.depc);
            }
            Rfwo | Rfwu => {
                if i.op == Rfwo {
                    self.windowstart &= !(1 << self.windowbase);
                } else {
                    self.windowstart |= 1 << self.windowbase;
                }
                self.windowbase = (self.ps & PS_OWB) >> PS_OWB_SHIFT;
                self.ps &= !PS_EXCM;
                jump = Some(self.epc[1]);
            }
            Rfi => {
                let level = s as usize;
                if !(2..=7).contains(&level) {
                    raise!(EXC_ILLEGAL);
                }
                self.ps = self.eps[level] & PS_MASK;
                jump = Some(self.epc[level]);
            }
            Rfme => raise!(EXC_ILLEGAL),
            Rsil => {
                self.set_a(t, self.ps);
                self.ps = (self.ps & !PS_INTLEVEL) | s as u32;
            }
            Waiti => {
                self.ps = (self.ps & !PS_INTLEVEL) | s as u32;
                self.pc = next;
                self.waiting = true;
                return Step::Waiting;
            }
            J => jump = Some(rel(i.imm)),

            // --- Booleans -----------------------------------------------------------------
            Any4 | All4 | Any8 | All8 => {
                let (width, base) = if matches!(i.op, Any4 | All4) { (4, s & !3) } else { (8, s & !7) };
                let mask = ((1u32 << width) - 1) << base;
                let bits = self.br & mask;
                let v = if matches!(i.op, Any4 | Any8) { bits != 0 } else { bits == mask };
                self.set_b(t, v);
            }
            Andb => self.set_b(r, self.b(s) & self.b(t)),
            Andbc => self.set_b(r, self.b(s) & !self.b(t)),
            Orb => self.set_b(r, self.b(s) | self.b(t)),
            Orbc => self.set_b(r, self.b(s) | !self.b(t)),
            Xorb => self.set_b(r, self.b(s) ^ self.b(t)),

            // --- Arithmetic and logic -----------------------------------------------------
            And => self.set_a(r, self.a(s) & self.a(t)),
            Or => self.set_a(r, self.a(s) | self.a(t)),
            Xor => self.set_a(r, self.a(s) ^ self.a(t)),
            Add | AddN => self.set_a(r, self.a(s).wrapping_add(self.a(t))),
            Addx2 => self.set_a(r, (self.a(s) << 1).wrapping_add(self.a(t))),
            Addx4 => self.set_a(r, (self.a(s) << 2).wrapping_add(self.a(t))),
            Addx8 => self.set_a(r, (self.a(s) << 3).wrapping_add(self.a(t))),
            Sub => self.set_a(r, self.a(s).wrapping_sub(self.a(t))),
            Subx2 => self.set_a(r, (self.a(s) << 1).wrapping_sub(self.a(t))),
            Subx4 => self.set_a(r, (self.a(s) << 2).wrapping_sub(self.a(t))),
            Subx8 => self.set_a(r, (self.a(s) << 3).wrapping_sub(self.a(t))),
            Neg => self.set_a(r, self.a(t).wrapping_neg()),
            Abs => self.set_a(r, (self.a(t) as i32).wrapping_abs() as u32),
            Addi => self.set_a(t, self.a(s).wrapping_add(i.imm as u32)),
            Addmi => self.set_a(t, self.a(s).wrapping_add(i.imm as u32)),
            AddiN => self.set_a(r, self.a(s).wrapping_add(i.imm as u32)),
            Movi => self.set_a(t, i.imm as u32),
            MoviN => self.set_a(s, i.imm as u32),
            MovN => self.set_a(t, self.a(s)),
            Moveqz => {
                if self.a(t) == 0 {
                    self.set_a(r, self.a(s))
                }
            }
            Movnez => {
                if self.a(t) != 0 {
                    self.set_a(r, self.a(s))
                }
            }
            Movltz => {
                if (self.a(t) as i32) < 0 {
                    self.set_a(r, self.a(s))
                }
            }
            Movgez => {
                if (self.a(t) as i32) >= 0 {
                    self.set_a(r, self.a(s))
                }
            }
            Movf => {
                if !self.b(t) {
                    self.set_a(r, self.a(s))
                }
            }
            Movt => {
                if self.b(t) {
                    self.set_a(r, self.a(s))
                }
            }
            Min => self.set_a(r, (self.a(s) as i32).min(self.a(t) as i32) as u32),
            Max => self.set_a(r, (self.a(s) as i32).max(self.a(t) as i32) as u32),
            Minu => self.set_a(r, self.a(s).min(self.a(t))),
            Maxu => self.set_a(r, self.a(s).max(self.a(t))),
            Sext => {
                let shift = 31 - i.imm as u32;
                self.set_a(r, (((self.a(s) << shift) as i32) >> shift) as u32);
            }
            Clamps => {
                let lim = 1i64 << i.imm;
                let v = (self.a(s) as i32 as i64).clamp(-lim, lim - 1);
                self.set_a(r, v as i32 as u32);
            }
            Nsa => {
                let v = self.a(s) as i32;
                let n = if v < 0 { (!v).leading_zeros() } else { v.leading_zeros() };
                self.set_a(t, if n == 0 { 0 } else { n - 1 }.min(31));
            }
            Nsau => self.set_a(t, self.a(s).leading_zeros()),
            Mul16u => self.set_a(r, (self.a(s) & 0xffff) * (self.a(t) & 0xffff)),
            Mul16s => self.set_a(r, ((self.a(s) as i16 as i32) * (self.a(t) as i16 as i32)) as u32),
            Mull => self.set_a(r, self.a(s).wrapping_mul(self.a(t))),
            Muluh => self.set_a(r, ((self.a(s) as u64 * self.a(t) as u64) >> 32) as u32),
            Mulsh => self.set_a(r, ((self.a(s) as i32 as i64 * self.a(t) as i32 as i64) >> 32) as u32),
            Quou | Quos | Remu | Rems => {
                if self.a(t) == 0 {
                    raise!(EXC_DIVIDE_BY_ZERO);
                }
                let (x, y) = (self.a(s), self.a(t));
                let v = match i.op {
                    Quou => x / y,
                    Remu => x % y,
                    Quos => (x as i32).wrapping_div(y as i32) as u32,
                    _ => (x as i32).wrapping_rem(y as i32) as u32,
                };
                self.set_a(r, v);
            }

            // --- Shifts -------------------------------------------------------------------
            Ssr => self.sar = self.a(s) & 31,
            Ssl => self.sar = 32 - (self.a(s) & 31),
            Ssa8l => self.sar = (self.a(s) & 3) * 8,
            Ssa8b => self.sar = 32 - (self.a(s) & 3) * 8,
            Ssai => self.sar = i.imm as u32,
            Slli => self.set_a(r, self.a(s) << (i.imm as u32 & 31)),
            Srai => self.set_a(r, ((self.a(t) as i32) >> i.imm) as u32),
            Srli => self.set_a(r, self.a(t) >> i.imm),
            Extui => self.set_a(r, (self.a(t) >> i.imm) & ((1u32 << i.imm2) - 1)),
            Src => {
                let v = ((self.a(s) as u64) << 32) | self.a(t) as u64;
                self.set_a(r, (v >> self.sar) as u32);
            }
            Srl => self.set_a(r, ((self.a(t) as u64) >> self.sar) as u32),
            Sra => self.set_a(r, ((self.a(t) as i32 as i64) >> self.sar) as u32),
            Sll => self.set_a(r, (((self.a(s) as u64) << 32) >> self.sar) as u32),

            // --- Special registers --------------------------------------------------------
            Rsr => {
                let v = self.read_sr(i.imm as u32);
                self.set_a(t, v);
            }
            Wsr => self.write_sr(i.imm as u32, self.a(t)),
            Xsr => {
                let old = self.read_sr(i.imm as u32);
                self.write_sr(i.imm as u32, self.a(t));
                self.set_a(t, old);
            }
            Rur => {
                let v = self.read_ur(i.imm as u32);
                self.set_a(r, v);
            }
            Wur => self.write_ur(i.imm as u32, self.a(t)),
            // --- Region protection: attributes are stored; access checks are not enforced yet
            Witlb => self.itlb_attr[(self.a(s) >> 29) as usize] = self.a(t) & 0xf,
            Wdtlb => self.dtlb_attr[(self.a(s) >> 29) as usize] = self.a(t) & 0xf,
            Iitlb | Idtlb => {}
            Ritlb0 | Rdtlb0 => self.set_a(t, self.a(s) & 0xe000_0000),
            Ritlb1 | Pitlb => {
                let region = self.a(s) & 0xe000_0000;
                self.set_a(t, region | self.itlb_attr[(region >> 29) as usize]);
            }
            Rdtlb1 | Pdtlb => {
                let region = self.a(s) & 0xe000_0000;
                self.set_a(t, region | self.dtlb_attr[(region >> 29) as usize]);
            }
            // External registers (ERI): not modelled
            Rer => self.set_a(t, 0),
            Wer => {}

            // --- Loads and stores ---------------------------------------------------------
            L32r => {
                let addr = if self.litbase & 1 != 0 {
                    (self.litbase & !0xfff).wrapping_add(i.imm as u32)
                } else {
                    (pc.wrapping_add(3) & !3).wrapping_add(i.imm as u32)
                };
                let v = ld!(addr, 4);
                self.set_a(t, v);
            }
            L8ui => {
                let v = ld!(self.a(s).wrapping_add(i.imm as u32), 1);
                self.set_a(t, v);
            }
            L16ui => {
                let v = ld!(self.a(s).wrapping_add(i.imm as u32), 2);
                self.set_a(t, v);
            }
            L16si => {
                let v = ld!(self.a(s).wrapping_add(i.imm as u32), 2);
                self.set_a(t, v as i16 as i32 as u32);
            }
            L32i | L32iN | L32ai | L32e => {
                let v = ld!(self.a(s).wrapping_add(i.imm as u32), 4);
                self.set_a(t, v);
            }
            S8i => st!(self.a(s).wrapping_add(i.imm as u32), 1, self.a(t)),
            S16i => st!(self.a(s).wrapping_add(i.imm as u32), 2, self.a(t)),
            S32i | S32iN | S32ri | S32e => st!(self.a(s).wrapping_add(i.imm as u32), 4, self.a(t)),
            S32c1i => {
                let addr = self.a(s).wrapping_add(i.imm as u32);
                let old = ld!(addr, 4);
                if old == self.scompare1 {
                    st!(addr, 4, self.a(t));
                }
                self.set_a(t, old);
            }

            // --- Branches -----------------------------------------------------------------
            Beqz | BeqzN => branch!(self.a(s) == 0, i.imm),
            Bnez | BnezN => branch!(self.a(s) != 0, i.imm),
            Bltz => branch!((self.a(s) as i32) < 0, i.imm),
            Bgez => branch!((self.a(s) as i32) >= 0, i.imm),
            Beqi => branch!(self.a(s) as i32 == i.imm, i.imm2),
            Bnei => branch!(self.a(s) as i32 != i.imm, i.imm2),
            Blti => branch!((self.a(s) as i32) < i.imm, i.imm2),
            Bgei => branch!((self.a(s) as i32) >= i.imm, i.imm2),
            Bltui => branch!(self.a(s) < i.imm as u32, i.imm2),
            Bgeui => branch!(self.a(s) >= i.imm as u32, i.imm2),
            Bbci => branch!(self.a(s) & (1 << i.imm) == 0, i.imm2),
            Bbsi => branch!(self.a(s) & (1 << i.imm) != 0, i.imm2),
            Bf => branch!(!self.b(s), i.imm),
            Bt => branch!(self.b(s), i.imm),
            Bnone => branch!(self.a(s) & self.a(t) == 0, i.imm),
            Bany => branch!(self.a(s) & self.a(t) != 0, i.imm),
            Ball => branch!(!self.a(s) & self.a(t) == 0, i.imm),
            Bnall => branch!(!self.a(s) & self.a(t) != 0, i.imm),
            Beq => branch!(self.a(s) == self.a(t), i.imm),
            Bne => branch!(self.a(s) != self.a(t), i.imm),
            Blt => branch!((self.a(s) as i32) < (self.a(t) as i32), i.imm),
            Bge => branch!((self.a(s) as i32) >= (self.a(t) as i32), i.imm),
            Bltu => branch!(self.a(s) < self.a(t), i.imm),
            Bgeu => branch!(self.a(s) >= self.a(t), i.imm),
            Bbc => branch!(self.a(s) & (1 << (self.a(t) & 31)) == 0, i.imm),
            Bbs => branch!(self.a(s) & (1 << (self.a(t) & 31)) != 0, i.imm),
            Loop | Loopnez | Loopgtz => {
                let count = self.a(s);
                self.lbeg = next;
                self.lend = rel(i.imm);
                self.lcount = count.wrapping_sub(1);
                let skip = match i.op {
                    Loopnez => count == 0,
                    Loopgtz => (count as i32) <= 0,
                    _ => false,
                };
                if skip {
                    jump = Some(self.lend);
                }
            }

            // --- Floating point -----------------------------------------------------------
            Lsi | Lsiu => {
                let addr = self.a(s).wrapping_add(i.imm as u32);
                self.f[t as usize] = ld!(addr, 4);
                if i.op == Lsiu {
                    self.set_a(s, addr);
                }
            }
            Ssi | Ssiu => {
                let addr = self.a(s).wrapping_add(i.imm as u32);
                st!(addr, 4, self.f[t as usize]);
                if i.op == Ssiu {
                    self.set_a(s, addr);
                }
            }
            Lsx | Lsxu => {
                let addr = self.a(s).wrapping_add(self.a(t));
                self.f[r as usize] = ld!(addr, 4);
                if i.op == Lsxu {
                    self.set_a(s, addr);
                }
            }
            Ssx | Ssxu => {
                let addr = self.a(s).wrapping_add(self.a(t));
                st!(addr, 4, self.f[r as usize]);
                if i.op == Ssxu {
                    self.set_a(s, addr);
                }
            }
            AddS => self.set_fs(r, self.fs(s) + self.fs(t)),
            SubS => self.set_fs(r, self.fs(s) - self.fs(t)),
            MulS => self.set_fs(r, self.fs(s) * self.fs(t)),
            MaddS => self.set_fs(r, self.fs(s).mul_add(self.fs(t), self.fs(r))),
            MsubS => self.set_fs(r, (-self.fs(s)).mul_add(self.fs(t), self.fs(r))),
            RoundS | TruncS | FloorS | CeilS | UtruncS => {
                let v = self.fs(s) as f64 * (1u64 << t) as f64;
                let v = match i.op {
                    RoundS => v.round_ties_even(),
                    TruncS | UtruncS => v.trunc(),
                    FloorS => v.floor(),
                    _ => v.ceil(),
                };
                // Rust float→int casts saturate, matching the hardware's clamping
                let out = if i.op == UtruncS { v as u32 } else { v as i32 as u32 };
                self.set_a(r, out);
            }
            FloatS => self.set_fs(r, (self.a(s) as i32 as f64 / (1u64 << t) as f64) as f32),
            UfloatS => self.set_fs(r, (self.a(s) as f64 / (1u64 << t) as f64) as f32),
            MovS => self.f[r as usize] = self.f[s as usize],
            AbsS => self.f[r as usize] = self.f[s as usize] & 0x7fff_ffff,
            NegS => self.f[r as usize] = self.f[s as usize] ^ 0x8000_0000,
            Rfr => self.set_a(r, self.f[s as usize]),
            Wfr => self.f[r as usize] = self.a(s),
            UnS | OeqS | UeqS | OltS | UltS | OleS | UleS => {
                let (x, y) = (self.fs(s), self.fs(t));
                let un = x.is_nan() || y.is_nan();
                let v = match i.op {
                    UnS => un,
                    OeqS => x == y,
                    UeqS => un || x == y,
                    OltS => x < y,
                    UltS => un || x < y,
                    OleS => x <= y,
                    _ => un || x <= y,
                };
                self.set_b(r, v);
            }
            MoveqzS | MovnezS | MovltzS | MovgezS => {
                let v = self.a(t) as i32;
                let cond = match i.op {
                    MoveqzS => v == 0,
                    MovnezS => v != 0,
                    MovltzS => v < 0,
                    _ => v >= 0,
                };
                if cond {
                    self.f[r as usize] = self.f[s as usize];
                }
            }
            MovfS | MovtS => {
                if self.b(t) == (i.op == MovtS) {
                    self.f[r as usize] = self.f[s as usize];
                }
            }
        }

        self.pc = match jump {
            Some(target) => target,
            // Zero-overhead loop: falling into LEND jumps back to LBEG while LCOUNT ≠ 0
            None if next == self.lend && self.lcount != 0 && !self.excm() => {
                self.lcount -= 1;
                self.lbeg
            }
            None => next,
        };
        Step::Ok
    }

    /// CALLn target: (PC & ~3) + offset + 4 (the +4 is folded into `imm` by the decoder).
    fn call_target(&self, pc: u32, imm: i32) -> u32 {
        (pc & !3).wrapping_add(imm as u32)
    }
}
