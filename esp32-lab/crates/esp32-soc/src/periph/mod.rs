//! Peripheral address space 0x3FF0_0000–0x3FF7_FFFF.
//!
//! Peripherals that firmware depends on are modelled; every other register behaves like plain
//! storage and its first access is recorded in `unmodelled`, which is how missing models are
//! found when bringing up new firmware.

pub mod gpio;
pub mod i2c;
pub mod ledc;
pub mod rmt;
pub mod sens;
pub mod spi;
pub mod timg;
pub mod uart;

use std::collections::{BTreeMap, HashMap};

pub const DPORT: u32 = 0x3ff0_0000;
pub const UART0: u32 = 0x3ff4_0000;
pub const SPI1: u32 = 0x3ff4_2000;
pub const SPI0: u32 = 0x3ff4_3000;
pub const GPIO: u32 = 0x3ff4_4000;
pub const RTC_CNTL: u32 = 0x3ff4_8000;
pub const RTCIO: u32 = 0x3ff4_8400;
pub const SENS: u32 = 0x3ff4_8800;
pub const IO_MUX: u32 = 0x3ff4_9000;
pub const UART1: u32 = 0x3ff5_0000;
pub const LEDC: u32 = 0x3ff5_9000;
pub const RMT: u32 = 0x3ff5_6000;
pub const I2C0: u32 = 0x3ff5_3000;
pub const I2C1: u32 = 0x3ff6_7000;
pub const EFUSE: u32 = 0x3ff5_a000;
pub const TIMG0: u32 = 0x3ff5_f000;
pub const TIMG1: u32 = 0x3ff6_0000;
pub const UART2: u32 = 0x3ff6_e000;
/// WDEV_RND_REG: hardware random number generator.
pub const RNG: u32 = 0x3ff7_5144;

// --- Interrupt matrix (TRM ch. Interrupt Matrix) -----------------------------------------
pub const SOURCES: usize = 71;
pub const SRC_TG0_T0: usize = 14;
pub const SRC_TG0_LACT: usize = 17;
pub const SRC_TG1_T0: usize = 18;
pub const SRC_FROM_CPU0: usize = 24;
pub const SRC_UART0: usize = 34;
pub const SRC_RMT: usize = 47;
pub const SRC_I2C0: usize = 49;
const PRO_INTR_MAP: u32 = 0x104;
const APP_INTR_MAP: u32 = 0x218;
const CPU_INTR_FROM_CPU: u32 = 0xdc;
/// DPORT_PERIP_RST_EN: peripheral resets (the I2C driver resets a controller after a NACK).
const PERIP_RST_EN: u32 = 0xc4;
const RST_I2C: [u32; 2] = [1 << 7, 1 << 18];
const RST_RMT: u32 = 1 << 9;

// --- DPORT: APP_CPU control ---------------------------------------------------------------
const APPCPU_CTRL_A: u32 = 0x2c; // RESETTING
const APPCPU_CTRL_B: u32 = 0x30; // CLKGATE_EN
const APPCPU_CTRL_C: u32 = 0x34; // RUNSTALL

// --- RTC_CNTL ------------------------------------------------------------------------------
const RTC_TIME_UPDATE: u32 = 0x0c;
const RTC_TIME0: u32 = 0x10;
const RTC_TIME1: u32 = 0x14;
const RTC_RESET_STATE: u32 = 0x34;
const RTC_STORE1: u32 = 0x50;
const RTC_STORE4: u32 = 0xb0;
const RTC_STORE5: u32 = 0xb4;

pub struct Periph {
    pub uart: [uart::Uart; 3],
    pub gpio: gpio::Gpio,
    /// LED PWM controller; its outputs reach pads through the GPIO matrix.
    pub ledc: ledc::Ledc,
    pub i2c: [i2c::I2c; 2],
    /// Remote control transmitter (WS2812 drivers); also reaches pads through the matrix.
    pub rmt: rmt::Rmt,
    /// SAR ADCs, fed with pad voltages by the circuit simulator.
    pub sens: sens::Sens,
    /// SPI0 (cache) and SPI1 (direct flash access) controllers.
    pub spi: [spi::Spi; 2],
    pub timg: [timg::TimerGroup; 2],
    /// Interrupt matrix: CPU interrupt number for each source, per CPU (≥ 32 = not routed).
    pub intr_map: [[u8; SOURCES]; 2],
    pub from_cpu: [bool; 4],
    pub appcpu_boot_addr: Option<u32>,
    /// Plain storage for everything not modelled, keyed by absolute address.
    regs: HashMap<u32, u32>,
    /// A register write may have changed an interrupt source (raised a cross-CPU interrupt,
    /// cleared or enabled one): the CPUs' lines must be recomputed before the next instruction.
    pub irq_dirty: bool,
    /// Unmodelled registers touched: address → (reads, writes).
    pub unmodelled: BTreeMap<u32, (u32, u32)>,
    pub efuse: HashMap<u32, u32>,
    /// xorshift state behind the RNG register: deterministic, so runs are reproducible.
    rng: u32,
}

impl Periph {
    pub fn new(mac: [u8; 6]) -> Self {
        let mut p = Self {
            uart: Default::default(),
            gpio: Default::default(),
            ledc: Default::default(),
            i2c: Default::default(),
            rmt: Default::default(),
            sens: Default::default(),
            spi: Default::default(),
            timg: Default::default(),
            // Reset value of every map register is 16 (unused); 16+ is treated as unrouted
            intr_map: [[16; SOURCES]; 2],
            from_cpu: [false; 4],
            appcpu_boot_addr: None,
            regs: HashMap::new(),
            irq_dirty: false,
            unmodelled: BTreeMap::new(),
            efuse: HashMap::new(),
            rng: 0x2545_f491,
        };
        // What the ROM and second-stage bootloader leave behind
        p.regs.insert(RTC_CNTL + RTC_RESET_STATE, 1 | (1 << 6)); // POWERON_RESET on both CPUs
        p.regs.insert(RTC_CNTL + RTC_STORE4, 0x0028_0028); // XTAL = 40 MHz
        p.regs.insert(RTC_CNTL + RTC_STORE5, 0x4c4b_4c4b); // APB = 80 MHz (>> 12)
        p.regs.insert(RTC_CNTL + RTC_STORE1, 0x0035_5555); // slow clock period, Q13.19 µs
        p.regs.insert(DPORT + 0x3c, 2); // CPU_PER_CONF: 240 MHz
        p.regs.insert(DPORT + APPCPU_CTRL_A, 1); // APP_CPU held in reset
        p.regs.insert(DPORT + APPCPU_CTRL_C, 0);
        p.regs.insert(0x3ff6_607c, 0x8000_0000); // APB_CTRL_DATE bit 31: chip revision 3
        // DPORT_{PRO,APP}_DCACHE_DBUG0: CACHE_STATE [18:7] = 1 (idle)
        p.regs.insert(DPORT + 0x3f0, 1 << 7);
        p.regs.insert(DPORT + 0x418, 1 << 7);
        p.set_efuse_mac(mac);
        p
    }

    /// eFuse BLK0: MAC (with its CRC8) and chip revision 3, package ESP32-D0WD-V3.
    fn set_efuse_mac(&mut self, mac: [u8; 6]) {
        // esp_efuse_mac_get_default checks the CRC over the MAC in display order
        let crc = crc8_maxim(&mac);
        // RDATA1 = MAC[31:0] (byte 5 lowest), RDATA2 = MAC[47:32] | CRC << 16
        let w1 = u32::from_le_bytes([mac[5], mac[4], mac[3], mac[2]]);
        let w2 = (mac[1] as u32) | ((mac[0] as u32) << 8) | ((crc as u32) << 16);
        self.efuse.insert(0x004, w1);
        self.efuse.insert(0x008, w2);
        // RDATA3: CHIP_VER_REV1 (bit 15), package D0WD (bits 11:9 = 0)
        self.efuse.insert(0x00c, 1 << 15);
        // RDATA4: ADC_VREF [12:8] = sign-magnitude −0 × 7 mV: "burned", reference exactly 1100 mV.
        // Without it ESP-IDF has no ADC calibration and analogReadMilliVolts() fails
        self.efuse.insert(0x010, 0x10 << 8);
        // RDATA5: CHIP_VER_REV2 (bit 20)
        self.efuse.insert(0x014, 1 << 20);
    }

    fn note(&mut self, addr: u32, write: bool) {
        let e = self.unmodelled.entry(addr).or_default();
        if write { e.1 += 1 } else { e.0 += 1 }
    }

    pub fn read(&mut self, addr: u32, apb: u64) -> u32 {
        let off = addr & 0xfff;
        match addr & !0xfff {
            UART0 => self.uart[0].read(off),
            UART1 => self.uart[1].read(off),
            UART2 => self.uart[2].read(off),
            GPIO => self.gpio.read(off),
            IO_MUX => self.gpio.read_iomux(off),
            LEDC => self.ledc.read(off),
            I2C0 => self.i2c[0].read(off),
            I2C1 => self.i2c[1].read(off),
            RMT => self.rmt.read(off),
            SPI0 => self.spi[0].read(off),
            SPI1 => self.spi[1].read(off),
            TIMG0 => self.timg[0].read(off, apb),
            TIMG1 => self.timg[1].read(off, apb),
            EFUSE => self.efuse.get(&off).copied().unwrap_or(0),
            DPORT if (PRO_INTR_MAP..APP_INTR_MAP).contains(&off) => {
                self.intr_map[0][((off - PRO_INTR_MAP) / 4) as usize % SOURCES] as u32
            }
            DPORT if (APP_INTR_MAP..APP_INTR_MAP + 4 * SOURCES as u32).contains(&off) => {
                self.intr_map[1][((off - APP_INTR_MAP) / 4) as usize % SOURCES] as u32
            }
            DPORT if (CPU_INTR_FROM_CPU..CPU_INTR_FROM_CPU + 16).contains(&off) => {
                self.from_cpu[((off - CPU_INTR_FROM_CPU) / 4) as usize] as u32
            }
            _ if addr == RNG => {
                self.rng ^= self.rng << 13;
                self.rng ^= self.rng >> 17;
                self.rng ^= self.rng << 5;
                self.rng
            }
            _ if (SENS..SENS + 0x100).contains(&addr) => self.sens.read(addr - SENS),
            RTC_CNTL if off == RTC_TIME_UPDATE => 1 << 30, // TIME_VALID
            RTC_CNTL if off == RTC_TIME0 || off == RTC_TIME1 => {
                // RTC slow clock ≈ 150 kHz = APB / 533
                let t = apb / 533;
                if off == RTC_TIME0 { t as u32 } else { (t >> 32) as u32 }
            }
            _ => {
                if !self.regs.contains_key(&addr) {
                    self.note(addr, false);
                }
                self.regs.get(&addr).copied().unwrap_or(0)
            }
        }
    }

    /// Returns the SPI controller index if a flash command was started.
    pub fn write(&mut self, addr: u32, v: u32, apb: u64) -> Option<usize> {
        self.irq_dirty = true;
        let off = addr & 0xfff;
        match addr & !0xfff {
            SPI0 => return self.spi[0].write(off, v).then_some(0),
            SPI1 => return self.spi[1].write(off, v).then_some(1),
            UART0 => self.uart[0].write(off, v),
            UART1 => self.uart[1].write(off, v),
            UART2 => self.uart[2].write(off, v),
            GPIO => self.gpio.write(off, v),
            IO_MUX => self.gpio.write_iomux(off, v),
            LEDC => {
                self.ledc.write(off, v);
                // A new duty or frequency changes what the attached pads put out
                self.gpio.dirty = true;
            }
            I2C0 => self.i2c[0].write(off, v, apb),
            I2C1 => self.i2c[1].write(off, v, apb),
            RMT => {
                self.rmt.write(off, v, apb);
                self.gpio.dirty = true;
            }
            DPORT if off == PERIP_RST_EN => {
                for (k, bit) in RST_I2C.iter().enumerate() {
                    if v & bit != 0 {
                        self.i2c[k] = Default::default();
                    }
                }
                if v & RST_RMT != 0 {
                    let frames = std::mem::take(&mut self.rmt.frames);
                    self.rmt = Default::default();
                    self.rmt.frames = frames;
                }
                self.regs.insert(addr, v);
            }
            TIMG0 => self.timg[0].write(off, v, apb),
            TIMG1 => self.timg[1].write(off, v, apb),
            EFUSE => {}
            _ if (SENS..SENS + 0x100).contains(&addr) => self.sens.write(addr - SENS, v),
            DPORT if (PRO_INTR_MAP..APP_INTR_MAP).contains(&off) => {
                self.intr_map[0][((off - PRO_INTR_MAP) / 4) as usize % SOURCES] = (v & 0x1f) as u8
            }
            DPORT if (APP_INTR_MAP..APP_INTR_MAP + 4 * SOURCES as u32).contains(&off) => {
                self.intr_map[1][((off - APP_INTR_MAP) / 4) as usize % SOURCES] = (v & 0x1f) as u8
            }
            DPORT if (CPU_INTR_FROM_CPU..CPU_INTR_FROM_CPU + 16).contains(&off) => {
                self.from_cpu[((off - CPU_INTR_FROM_CPU) / 4) as usize] = v & 1 != 0
            }
            _ => {
                if (RTCIO..RTCIO + 0x100).contains(&addr) {
                    self.gpio.write_rtcio(addr - RTCIO, v);
                }
                if !self.regs.contains_key(&addr) {
                    self.note(addr, true);
                }
                self.regs.insert(addr, v);
            }
        }
        None
    }

    /// State of pad `n` as the circuit sees it: the GPIO registers, unless the GPIO matrix
    /// routes an LEDC channel to it, in which case the channel's level or waveform.
    pub fn pad(&self, n: usize) -> gpio::PadState {
        let mut p = self.gpio.pad(n);
        let sel = self.gpio.out_sel(n);
        let sig = sel & 0x1ff;
        // I2C pins are open drain and the bus idles HIGH: the pad lets go, the pull-ups hold it
        if i2c::SIG_SCL.contains(&sig) || i2c::SIG_SDA.contains(&sig) {
            p.output_enabled = false;
            return p;
        }
        let invert = sel & gpio::OUT_SEL_INV != 0;
        if (rmt::SIG_OUT0..=rmt::SIG_OUT7).contains(&sig) {
            // Between transmissions the idle level; a transmission reaches the circuit as a frame
            if sel & gpio::OUT_SEL_OEN_FROM_GPIO == 0 {
                p.output_enabled = true;
            }
            p.level = self.rmt.idle_level(sig) != invert;
        }
        if (ledc::SIG_HS0..=ledc::SIG_LS7).contains(&sig) {
            // OEN_SEL clear: the peripheral enables the output (LEDC always does)
            if sel & gpio::OUT_SEL_OEN_FROM_GPIO == 0 {
                p.output_enabled = true;
            }
            match self.ledc.output(sig) {
                ledc::Output::Steady(level) => p.level = level != invert,
                ledc::Output::Pwm { period_ns, high_ns } => {
                    p.level = true;
                    p.pwm_period_ns = period_ns;
                    p.pwm_high_ns = if invert { period_ns - high_ns } else { high_ns };
                }
            }
        }
        p
    }

    /// GPIOs carrying SDA and SCL of I2C controller `port` (through the GPIO matrix), if routed.
    pub fn i2c_pins(&self, port: usize) -> (Option<usize>, Option<usize>) {
        let find = |sig: u32| (0..gpio::PADS).find(|&n| self.gpio.out_sel(n) & 0x1ff == sig);
        (find(i2c::SIG_SDA[port]), find(i2c::SIG_SCL[port]))
    }

    /// Finished RMT transmissions with the GPIO each one went out on (`None`: not routed to a pad).
    pub fn take_rmt(&mut self) -> Vec<(Option<usize>, rmt::Frame)> {
        let frames = std::mem::take(&mut self.rmt.frames);
        frames
            .into_iter()
            .map(|mut f| {
                let sig = rmt::SIG_OUT0 + f.channel as u32;
                let pad = (0..gpio::PADS).find(|&n| self.gpio.out_sel(n) & 0x1ff == sig);
                if pad.is_some_and(|n| self.gpio.out_sel(n) & gpio::OUT_SEL_INV != 0) {
                    for p in &mut f.pulses {
                        p.0 = !p.0;
                    }
                }
                (pad, f)
            })
            .collect()
    }

    /// APP_CPU may run: clock enabled, out of reset, not stalled, boot address set.
    pub fn appcpu_released(&self) -> bool {
        let r = |o: u32| self.regs.get(&(DPORT + o)).copied().unwrap_or(0) & 1;
        r(APPCPU_CTRL_B) == 1 && r(APPCPU_CTRL_A) == 0 && r(APPCPU_CTRL_C) == 0 && self.appcpu_boot_addr.is_some()
    }

    /// Level of every interrupt source.
    pub fn sources(&self) -> [bool; SOURCES] {
        let mut s = [false; SOURCES];
        for g in 0..2 {
            let base = if g == 0 { SRC_TG0_T0 } else { SRC_TG1_T0 };
            for k in 0..4 {
                s[base + k] = self.timg[g].irq(k);
            }
        }
        for k in 0..4 {
            s[SRC_FROM_CPU0 + k] = self.from_cpu[k];
        }
        for k in 0..3 {
            s[SRC_UART0 + k] = self.uart[k].irq();
        }
        for k in 0..2 {
            s[SRC_I2C0 + k] = self.i2c[k].irq();
        }
        s[SRC_RMT] = self.rmt.irq();
        s
    }

    /// CPU interrupt lines (level view) for one CPU, through the interrupt matrix.
    pub fn cpu_lines(&self, cpu: usize, sources: &[bool; SOURCES]) -> u32 {
        let mut lines = 0;
        for (src, &on) in sources.iter().enumerate() {
            let n = self.intr_map[cpu][src];
            // 6, 7, 11, 15, 16, 29 are internal (timer/software/profiling): not routable
            if on && n < 32 && !matches!(n, 6 | 7 | 11 | 15 | 16 | 29) {
                lines |= 1 << n;
            }
        }
        lines
    }

    pub fn update(&mut self, apb: u64) {
        for t in &mut self.timg {
            t.update(apb);
        }
        for i in &mut self.i2c {
            i.update(apb);
        }
        self.rmt.update(apb);
    }

    pub fn apb_until_event(&self, apb: u64) -> Option<u64> {
        let timers = self.timg.iter().filter_map(|t| t.apb_until_event(apb));
        let i2c = self.i2c.iter().filter_map(|i| i.apb_until_event(apb));
        timers.chain(i2c).chain(self.rmt.apb_until_event(apb)).min()
    }
}

/// Dallas/Maxim CRC-8 as used for the eFuse MAC (esp_crc8: poly 0x8C reflected, init 0).
pub fn crc8_maxim(data: &[u8]) -> u8 {
    let mut crc = 0u8;
    for &b in data {
        let mut x = b;
        for _ in 0..8 {
            let mix = (crc ^ x) & 1;
            crc >>= 1;
            if mix != 0 {
                crc ^= 0x8c;
            }
            x >>= 1;
        }
    }
    crc
}
