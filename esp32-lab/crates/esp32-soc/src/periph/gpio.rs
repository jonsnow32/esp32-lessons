//! GPIO matrix and IO_MUX: which pads are outputs, their level, pulls and drive strength.
//! This is the chip side of the pad boundary used by the circuit simulator.

pub const PADS: usize = 40;

const OUT: u32 = 0x04;
const OUT_W1TS: u32 = 0x08;
const OUT_W1TC: u32 = 0x0c;
const OUT1: u32 = 0x10;
const OUT1_W1TS: u32 = 0x14;
const OUT1_W1TC: u32 = 0x18;
const ENABLE: u32 = 0x20;
const ENABLE_W1TS: u32 = 0x24;
const ENABLE_W1TC: u32 = 0x28;
const ENABLE1: u32 = 0x2c;
const ENABLE1_W1TS: u32 = 0x30;
const ENABLE1_W1TC: u32 = 0x34;
const IN: u32 = 0x3c;
const IN1: u32 = 0x40;
/// GPIO_FUNCn_OUT_SEL_CFG: which matrix signal drives pad n.
const FUNC_OUT_SEL: u32 = 0x530;
/// Signal 256: the pad follows GPIO_OUT (the reset value).
pub const SIG_GPIO_OUT: u32 = 256;
pub const OUT_SEL_INV: u32 = 1 << 9;
pub const OUT_SEL_OEN_FROM_GPIO: u32 = 1 << 10;

/// IO_MUX register offset for each GPIO (TRM table "IO_MUX Pad Summary"); 0 = no pad.
pub const IO_MUX_OFFSET: [u32; PADS] = [
    0x44, 0x88, 0x40, 0x84, 0x48, 0x6c, 0x60, 0x64, 0x68, 0x54, 0x58, 0x5c, 0x34, 0x38, 0x30, 0x3c, //
    0x4c, 0x50, 0x70, 0x74, 0x78, 0x7c, 0x80, 0x8c, 0x90, 0x24, 0x28, 0x2c, 0, 0, 0, 0, //
    0x1c, 0x20, 0x14, 0x18, 0x04, 0x08, 0x0c, 0x10,
];

/// RTCIO pull control for RTC-capable pads: (gpio, RTCIO register offset, RUE bit, RDE bit).
pub const RTC_PULLS: [(usize, u32, u32, u32); 12] = [
    (0, 0x98, 27, 28),
    (2, 0x9c, 27, 28),
    (4, 0x94, 27, 28),
    (12, 0xa8, 27, 28),
    (13, 0xa4, 27, 28),
    (14, 0xac, 27, 28),
    (15, 0xa0, 27, 28),
    (25, 0x84, 27, 28),
    (26, 0x88, 27, 28),
    (27, 0xb0, 27, 28),
    (32, 0x8c, 22, 23),
    (33, 0x8c, 27, 28),
];

const MUX_FUN_WPD: u32 = 1 << 7;
const MUX_FUN_WPU: u32 = 1 << 8;
const MUX_FUN_IE: u32 = 1 << 9;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PadState {
    pub output_enabled: bool,
    pub level: bool,
    pub pull_up: bool,
    pub pull_down: bool,
    pub input_enabled: bool,
    pub drive: u8,
    /// A PWM signal drives the pad: its period and time HIGH (ns); 0 = no waveform, `level` holds.
    pub pwm_period_ns: u32,
    pub pwm_high_ns: u32,
}

pub struct Gpio {
    pub out: u64,
    pub enable: u64,
    /// Logic level seen at each pad (from the circuit).
    pub input: u64,
    /// Pulls on RTC-capable pads live in RTCIO registers, not IO_MUX (see RTC_PULLS).
    pub rtc_pull_up: u64,
    pub rtc_pull_down: u64,
    /// Pull-ups soldered on the board (the DevKit's 10 kΩ on GPIO0), used when no circuit
    /// simulator is attached.
    pub board_pull_up: u64,
    /// Pads driven from outside the chip (a button, the circuit simulator): mask and levels.
    pub external_mask: u64,
    pub external_level: u64,
    /// Set by any write that can change a pad; the SoC re-scans pads only then.
    pub dirty: bool,
    iomux: [u32; PADS],
    regs: std::collections::HashMap<u32, u32>,
}

impl Default for Gpio {
    fn default() -> Self {
        Self {
            out: 0,
            enable: 0,
            input: 0,
            rtc_pull_up: 0,
            rtc_pull_down: 0,
            board_pull_up: 0,
            external_mask: 0,
            external_level: 0,
            dirty: true,
            iomux: [2 << 10; PADS],
            regs: Default::default(),
        }
    }
}

impl Gpio {
    pub fn pad(&self, n: usize) -> PadState {
        let mux = self.iomux[n];
        PadState {
            output_enabled: self.enable & (1 << n) != 0,
            level: self.out & (1 << n) != 0,
            pull_up: mux & MUX_FUN_WPU != 0 || self.rtc_pull_up & (1 << n) != 0,
            pull_down: mux & MUX_FUN_WPD != 0 || self.rtc_pull_down & (1 << n) != 0,
            input_enabled: mux & MUX_FUN_IE != 0,
            drive: ((mux >> 10) & 3) as u8,
            pwm_period_ns: 0,
            pwm_high_ns: 0,
        }
    }

    /// GPIO_FUNCn_OUT_SEL_CFG of pad `n`.
    pub fn out_sel(&self, n: usize) -> u32 {
        self.regs.get(&(FUNC_OUT_SEL + 4 * n as u32)).copied().unwrap_or(SIG_GPIO_OUT)
    }

    /// Level at every pad: an external driver wins, otherwise the pad's own output, otherwise
    /// its pull resistor. (With the circuit simulator attached, the circuit decides instead.)
    pub fn resolve_input(&self) -> u64 {
        let mut v = 0;
        for n in 0..PADS {
            let p = self.pad(n);
            let level = if self.external_mask & (1 << n) != 0 {
                self.external_level & (1 << n) != 0
            } else {
                (p.output_enabled && p.level) || (!p.output_enabled && (p.pull_up || self.board_pull_up & (1 << n) != 0))
            };
            if level {
                v |= 1 << n;
            }
        }
        v
    }

    pub fn read(&mut self, off: u32) -> u32 {
        match off {
            OUT => self.out as u32,
            OUT1 => (self.out >> 32) as u32,
            ENABLE => self.enable as u32,
            ENABLE1 => (self.enable >> 32) as u32,
            IN => self.input as u32,
            IN1 => (self.input >> 32) as u32,
            _ => self.regs.get(&off).copied().unwrap_or(0),
        }
    }

    pub fn write(&mut self, off: u32, v: u32) {
        self.dirty = true;
        let lo = v as u64;
        let hi = (v as u64 & 0xff) << 32;
        match off {
            OUT => self.out = (self.out & !0xffff_ffff) | lo,
            OUT_W1TS => self.out |= lo,
            OUT_W1TC => self.out &= !lo,
            OUT1 => self.out = (self.out & 0xffff_ffff) | hi,
            OUT1_W1TS => self.out |= hi,
            OUT1_W1TC => self.out &= !hi,
            ENABLE => self.enable = (self.enable & !0xffff_ffff) | lo,
            ENABLE_W1TS => self.enable |= lo,
            ENABLE_W1TC => self.enable &= !lo,
            ENABLE1 => self.enable = (self.enable & 0xffff_ffff) | hi,
            ENABLE1_W1TS => self.enable |= hi,
            ENABLE1_W1TC => self.enable &= !hi,
            _ => {
                self.regs.insert(off, v);
            }
        }
    }

    /// A write to an RTCIO pad register: update pulls of the pads it controls.
    pub fn write_rtcio(&mut self, off: u32, v: u32) {
        self.dirty = true;
        for &(gpio, reg, rue, rde) in &RTC_PULLS {
            if reg == off {
                let bit = 1u64 << gpio;
                if v & (1 << rue) != 0 { self.rtc_pull_up |= bit } else { self.rtc_pull_up &= !bit }
                if v & (1 << rde) != 0 { self.rtc_pull_down |= bit } else { self.rtc_pull_down &= !bit }
            }
        }
    }

    pub fn read_iomux(&self, off: u32) -> u32 {
        IO_MUX_OFFSET.iter().position(|&o| o == off && o != 0).map(|n| self.iomux[n]).unwrap_or(0)
    }

    pub fn write_iomux(&mut self, off: u32, v: u32) {
        self.dirty = true;
        if let Some(n) = IO_MUX_OFFSET.iter().position(|&o| o == off && o != 0) {
            self.iomux[n] = v;
        }
    }
}
