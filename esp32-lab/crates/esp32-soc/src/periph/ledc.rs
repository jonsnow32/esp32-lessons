//! LED PWM controller (TRM ch. 14): 8 high-speed + 8 low-speed channels, each driven by one of
//! its group's 4 timers. The circuit is not given every edge: an attached pad reports its
//! waveform as a period and a high time, which is what `analogWrite`, `ledcWrite` and `tone`
//! produce. Hardware fades are not modelled: a new duty applies at once.

/// GPIO matrix output signals: LEDC_HS_SIG_OUT0..7, LEDC_LS_SIG_OUT0..7.
pub const SIG_HS0: u32 = 71;
pub const SIG_LS7: u32 = 86;

const APB_HZ: f64 = 80e6;
const REF_TICK_HZ: f64 = 1e6;
/// RC_FAST (8 MHz) clock, the low-speed group's slow clock when APB is not selected.
const RC_FAST_HZ: f64 = 8e6;

const CH_STRIDE: u32 = 0x14;
const CH_CONF0: u32 = 0x00;
const CH_HPOINT: u32 = 0x04;
const CH_DUTY: u32 = 0x08;
const CH_CONF1: u32 = 0x0c;
const TIMERS: u32 = 0x140;
const INT_RAW: u32 = 0x180;
const INT_ST: u32 = 0x184;
const INT_ENA: u32 = 0x188;
const INT_CLR: u32 = 0x18c;
const CONF: u32 = 0x190;

const CONF0_SIG_OUT_EN: u32 = 1 << 2;
const CONF0_IDLE_LV: u32 = 1 << 3;
const CONF1_DUTY_START: u32 = 1 << 31;
const TIMER_PAUSE: u32 = 1 << 23;
const TIMER_RST: u32 = 1 << 24;
const TIMER_TICK_SEL: u32 = 1 << 25;
const CONF_SLOW_CLK_APB: u32 = 1;

/// What a channel puts out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Output {
    Steady(bool),
    /// Repeating waveform: period and time HIGH per period, in ns (0 < high < period).
    Pwm { period_ns: u32, high_ns: u32 },
}

#[derive(Default)]
pub struct Ledc {
    /// [group][channel]: conf0, hpoint, duty, conf1.
    ch: [[[u32; 4]; 8]; 2],
    /// [group][timer]: conf.
    timer: [[u32; 4]; 2],
    conf: u32,
    int_raw: u32,
    int_ena: u32,
}

impl Ledc {
    pub fn read(&self, off: u32) -> u32 {
        match off {
            0..TIMERS => {
                let (g, c, r) = channel_reg(off);
                match r {
                    CH_CONF0 | CH_HPOINT | CH_DUTY => self.ch[g][c][(r / 4) as usize],
                    // DUTY_START clears itself once the new duty is in use, which is at once here
                    CH_CONF1 => self.ch[g][c][3] & !CONF1_DUTY_START,
                    _ => self.ch[g][c][2], // DUTY_R: the duty in use
                }
            }
            TIMERS..INT_RAW => {
                let (g, t, value) = timer_reg(off);
                if value { 0 } else { self.timer[g][t] }
            }
            INT_RAW => self.int_raw,
            INT_ST => self.int_raw & self.int_ena,
            INT_ENA => self.int_ena,
            CONF => self.conf,
            _ => 0,
        }
    }

    pub fn write(&mut self, off: u32, v: u32) {
        match off {
            0..TIMERS => {
                let (g, c, r) = channel_reg(off);
                match r {
                    CH_CONF0 | CH_HPOINT | CH_DUTY => self.ch[g][c][(r / 4) as usize] = v,
                    CH_CONF1 => {
                        self.ch[g][c][3] = v & !CONF1_DUTY_START;
                        if v & CONF1_DUTY_START != 0 {
                            // The "fade" ends straight away
                            self.int_raw |= 1 << (8 + 8 * g + c);
                        }
                    }
                    _ => {} // DUTY_R is read-only
                }
            }
            TIMERS..INT_RAW => {
                let (g, t, value) = timer_reg(off);
                if !value {
                    self.timer[g][t] = v & !TIMER_RST;
                }
            }
            INT_ENA => self.int_ena = v,
            INT_CLR => self.int_raw &= !v,
            CONF => self.conf = v,
            _ => {}
        }
    }

    /// Timer clock frequency of timer `t` in group `g`.
    fn timer_hz(&self, g: usize, t: usize) -> f64 {
        let conf = self.timer[g][t];
        if conf & TIMER_TICK_SEL == 0 {
            REF_TICK_HZ
        } else if g == 0 || self.conf & CONF_SLOW_CLK_APB != 0 {
            APB_HZ
        } else {
            RC_FAST_HZ
        }
    }

    /// Output of matrix signal `sig` (one of the 16 LEDC signals).
    pub fn output(&self, sig: u32) -> Output {
        let n = (sig - SIG_HS0) as usize;
        let (g, c) = (n / 8, n % 8);
        let [conf0, hpoint, duty, _] = self.ch[g][c];
        let idle = Output::Steady(conf0 & CONF0_IDLE_LV != 0);
        let t = (conf0 & 3) as usize;
        let tconf = self.timer[g][t];
        let res = tconf & 0x1f;
        let div = (tconf >> 5) & 0x3_ffff;
        if conf0 & CONF0_SIG_OUT_EN == 0 || tconf & TIMER_PAUSE != 0 || div < 256 || res == 0 || res > 20 {
            return idle;
        }
        let steps = 1u64 << res;
        // Counter tick = div / 256 timer clocks; one period = 2^res ticks
        let tick_ns = (div as f64 / 256.0) / self.timer_hz(g, t) * 1e9;
        let period_ns = (steps as f64 * tick_ns).round();
        // Output goes HIGH at hpoint and LOW at hpoint + duty (duty has 4 fraction bits)
        let high_steps = ((duty & 0x1ff_ffff) as f64 / 16.0).min((steps - (hpoint & 0xf_ffff) as u64 % steps) as f64);
        let high_ns = (high_steps * tick_ns).round();
        if period_ns < 1.0 || period_ns > u32::MAX as f64 {
            return idle;
        }
        if high_ns <= 0.0 {
            Output::Steady(false)
        } else if high_ns >= period_ns {
            Output::Steady(true)
        } else {
            Output::Pwm { period_ns: period_ns as u32, high_ns: high_ns as u32 }
        }
    }
}

/// Channel register offset → (group, channel, register within the channel).
fn channel_reg(off: u32) -> (usize, usize, u32) {
    let n = off / CH_STRIDE;
    ((n / 8) as usize, (n % 8) as usize, off % CH_STRIDE)
}

/// Timer register offset → (group, timer, is the VALUE register).
fn timer_reg(off: u32) -> (usize, usize, bool) {
    let n = (off - TIMERS) / 8;
    ((n / 4) as usize, (n % 4) as usize, (off - TIMERS) % 8 == 4)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Channel `c` of group `g` on timer 0 at `freq` with `bits` resolution from APB, duty `duty`.
    fn setup(l: &mut Ledc, g: u32, c: u32, freq: f64, bits: u32, duty: u32) {
        let div = (APB_HZ / freq / (1u64 << bits) as f64 * 256.0).round() as u32;
        l.write(CONF, CONF_SLOW_CLK_APB);
        l.write(TIMERS + g * 0x20, bits | (div << 5) | TIMER_TICK_SEL);
        let base = g * 8 * CH_STRIDE + c * CH_STRIDE;
        l.write(base + CH_HPOINT, 0);
        l.write(base + CH_DUTY, duty << 4);
        l.write(base + CH_CONF0, CONF0_SIG_OUT_EN);
        l.write(base + CH_CONF1, CONF1_DUTY_START);
    }

    #[test]
    fn analog_write_at_5khz() {
        let mut l = Ledc::default();
        // analogWrite(pin, 128): 8-bit, 5 kHz
        setup(&mut l, 0, 0, 5000.0, 8, 128);
        assert_eq!(l.output(SIG_HS0), Output::Pwm { period_ns: 200_000, high_ns: 100_000 });
        assert_eq!(l.read(CH_CONF1) & CONF1_DUTY_START, 0);
    }

    #[test]
    fn servo_pulse_on_a_low_speed_channel() {
        let mut l = Ledc::default();
        // 50 Hz, 16 bits; 1.5 ms = 4915 / 65536 of 20 ms
        setup(&mut l, 1, 3, 50.0, 16, 4915);
        match l.output(SIG_HS0 + 8 + 3) {
            Output::Pwm { period_ns, high_ns } => {
                assert!((period_ns as i64 - 20_000_000).abs() < 2_000);
                assert!((high_ns as i64 - 1_500_000).abs() < 2_000);
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn full_and_zero_duty_are_steady() {
        let mut l = Ledc::default();
        setup(&mut l, 0, 1, 1000.0, 10, 1024);
        assert_eq!(l.output(SIG_HS0 + 1), Output::Steady(true));
        setup(&mut l, 0, 1, 1000.0, 10, 0);
        assert_eq!(l.output(SIG_HS0 + 1), Output::Steady(false));
        // Output disabled: the idle level
        l.write(CH_STRIDE + CH_CONF0, CONF0_IDLE_LV);
        assert_eq!(l.output(SIG_HS0 + 1), Output::Steady(true));
    }
}
