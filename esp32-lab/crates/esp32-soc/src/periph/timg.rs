//! Timer group (TRM ch. Timer Group): two 64-bit general timers, the LAC timer used by
//! esp_timer on the ESP32, the watchdog (accepted but never fires) and RTC clock calibration.

const INT_ENA: u32 = 0x98;
const INT_RAW: u32 = 0x9c;
const INT_ST: u32 = 0xa0;
const INT_CLR: u32 = 0xa4;
const RTCCALICFG: u32 = 0x68;
const RTCCALICFG1: u32 = 0x6c;

const CFG_EN: u32 = 1 << 31;
const CFG_INCREASE: u32 = 1 << 30;
const CFG_AUTORELOAD: u32 = 1 << 29;
const CFG_LEVEL_INT_EN: u32 = 1 << 11;
const CFG_ALARM_EN: u32 = 1 << 10;

/// One 64-bit up/down counter clocked by APB / divider.
#[derive(Default, Clone)]
pub struct Counter {
    config: u32,
    /// Counter value at `base_apb`.
    base_value: u64,
    base_apb: u64,
    latched: u64,
    alarm: u64,
    load: u64,
}

impl Counter {
    fn divider(&self) -> u64 {
        match (self.config >> 13) & 0xffff {
            0 => 65536,
            1 => 2,
            d => d as u64,
        }
    }

    pub fn value(&self, apb: u64) -> u64 {
        if self.config & CFG_EN == 0 {
            return self.base_value;
        }
        let ticks = (apb - self.base_apb) / self.divider();
        if self.config & CFG_INCREASE != 0 {
            self.base_value.wrapping_add(ticks)
        } else {
            self.base_value.wrapping_sub(ticks)
        }
    }

    /// Re-anchor so a config change doesn't retroactively rescale elapsed time.
    fn rebase(&mut self, apb: u64) {
        self.base_value = self.value(apb);
        self.base_apb = apb;
    }

    /// APB ticks until the alarm fires, if armed.
    fn apb_until_alarm(&self, apb: u64) -> Option<u64> {
        if self.config & (CFG_EN | CFG_ALARM_EN) != (CFG_EN | CFG_ALARM_EN) || self.config & CFG_INCREASE == 0 {
            return None;
        }
        let v = self.value(apb);
        Some(self.alarm.saturating_sub(v) * self.divider())
    }

    /// Returns true when the alarm fired (and handles auto-reload / ALARM_EN clearing).
    fn poll(&mut self, apb: u64) -> bool {
        if self.apb_until_alarm(apb) != Some(0) {
            return false;
        }
        self.config &= !CFG_ALARM_EN;
        if self.config & CFG_AUTORELOAD != 0 {
            self.base_value = self.load;
            self.base_apb = apb;
        }
        true
    }

    fn read(&self, off: u32) -> u32 {
        match off {
            0x00 => self.config,
            0x04 => self.latched as u32,
            0x08 => (self.latched >> 32) as u32,
            0x10 => self.alarm as u32,
            0x14 => (self.alarm >> 32) as u32,
            0x18 => self.load as u32,
            0x1c => (self.load >> 32) as u32,
            _ => 0,
        }
    }

    fn write(&mut self, off: u32, v: u32, apb: u64) {
        match off {
            0x00 => {
                self.rebase(apb);
                self.config = v;
            }
            0x0c => self.latched = self.value(apb),
            0x10 => self.alarm = (self.alarm & !0xffff_ffff) | v as u64,
            0x14 => self.alarm = (self.alarm & 0xffff_ffff) | ((v as u64) << 32),
            0x18 => self.load = (self.load & !0xffff_ffff) | v as u64,
            0x1c => self.load = (self.load & 0xffff_ffff) | ((v as u64) << 32),
            0x20 => {
                self.base_value = self.load;
                self.base_apb = apb;
            }
            _ => {}
        }
    }
}


#[derive(Default)]
pub struct TimerGroup {
    pub counters: [Counter; 3],
    raw: u32,
    ena: u32,
    cal_cfg: u32,
    regs: std::collections::HashMap<u32, u32>,
}

impl TimerGroup {
    fn counter_at(off: u32) -> Option<(usize, u32)> {
        match off {
            0x00..=0x20 => Some((0, off)),
            0x24..=0x44 => Some((1, off - 0x24)),
            0x70 => Some((2, 0x00)),
            0x78..=0x94 => Some((2, off - 0x74)),
            _ => None,
        }
    }

    pub fn update(&mut self, apb: u64) {
        for k in 0..3 {
            if self.counters[k].poll(apb) {
                self.raw |= [1, 2, 8][k];
            }
        }
    }

    pub fn apb_until_event(&self, apb: u64) -> Option<u64> {
        self.counters.iter().filter_map(|c| c.apb_until_alarm(apb)).min()
    }

    /// Level interrupt lines: (T0, T1, WDT, LACT).
    pub fn irq(&self, which: usize) -> bool {
        let level_en = self.counters.get(match which { 3 => 2, w => w }).map_or(false, |c| c.config & CFG_LEVEL_INT_EN != 0);
        let bit = [1, 2, 4, 8][which];
        level_en && self.raw & self.ena & bit != 0
    }

    pub fn read(&mut self, off: u32, apb: u64) -> u32 {
        self.update(apb);
        if let Some((k, o)) = Self::counter_at(off) {
            return self.counters[k].read(o);
        }
        match off {
            INT_ENA => self.ena,
            INT_RAW => self.raw,
            INT_ST => self.raw & self.ena,
            // Calibration finishes instantly: always ready
            RTCCALICFG => self.cal_cfg | (1 << 15),
            RTCCALICFG1 => {
                // XTAL (40 MHz) cycles counted over MAX slow-clock (150 kHz RC) cycles
                let slow_cycles = ((self.cal_cfg >> 16) & 0x7fff) as u64;
                ((slow_cycles * 40_000_000 / 150_000) as u32) << 7
            }
            _ => self.regs.get(&off).copied().unwrap_or(0),
        }
    }

    pub fn write(&mut self, off: u32, v: u32, apb: u64) {
        self.update(apb);
        if let Some((k, o)) = Self::counter_at(off) {
            self.counters[k].write(o, v, apb);
            return;
        }
        match off {
            INT_ENA => self.ena = v,
            INT_CLR => self.raw &= !v,
            RTCCALICFG => self.cal_cfg = v & !(1 << 15),
            _ => {
                self.regs.insert(off, v);
            }
        }
    }
}
