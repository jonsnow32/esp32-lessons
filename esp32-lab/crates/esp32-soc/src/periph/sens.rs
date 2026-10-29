//! SENS: the two SAR ADCs as the RTC controller drives them (TRM ch. On-Chip Sensors and Analog
//! Signal Processing). This is what `analogRead()` uses through ESP-IDF's adc_oneshot driver:
//! pick a channel in SAR_MEAS_START{1,2}.SAR_EN_PAD, pulse MEAS_START_SAR, poll MEAS_DONE_SAR,
//! read MEAS_DATA_SAR. A conversion completes the moment it is started.
//!
//! The voltage at every pad comes from the circuit simulator (`volts`). The transfer curve is
//! ESP-IDF's own calibration for a chip with the default 1100 mV reference (see the eFuse
//! ADC_VREF set in `Periph::new`) run backwards, so `analogReadMilliVolts()` reads back the pad
//! voltage, while `analogRead()` shows the real chip's offset near 0 V and its saturation near
//! 3.1 V.

use super::gpio::PADS;

const READ_CTRL: u32 = 0x00;
const START_FORCE: u32 = 0x2c;
const ATTEN1: u32 = 0x34;
const ATTEN2: u32 = 0x38;
const MEAS_START1: u32 = 0x54;
const READ_CTRL2: u32 = 0x90;
const MEAS_START2: u32 = 0x94;

const DATA_MASK: u32 = 0xffff;
const DONE: u32 = 1 << 16;
const START: u32 = 1 << 17;
const EN_PAD_SHIFT: u32 = 19;
const SAR1_DATA_INV: u32 = 1 << 28;
const SAR2_DATA_INV: u32 = 1 << 29;

/// GPIO behind each channel (TRM table "ADC Channels").
pub const ADC1_GPIO: [usize; 8] = [36, 37, 38, 39, 32, 33, 34, 35];
pub const ADC2_GPIO: [usize; 10] = [4, 0, 2, 15, 13, 12, 14, 27, 25, 26];

/// What ESP-IDF's calibration (adc_cali_line_fitting, Vref 1100 mV) says raw 0, 128, 256, … 3968,
/// 4095 mean in mV, per ADC and attenuation 0 / 2.5 / 6 / 11 dB; dumped from the firmware with
/// adc_cali_raw_to_voltage(). At 11 dB it is Espressif's measured curve: straight up to about
/// 2.4 V, then flattening until 4095 at about 3.13 V, as on a real chip.
const CURVE_MV: [[[u16; 33]; 4]; 2] = [
    [
        [75, 105, 135, 165, 195, 225, 255, 285, 314, 344, 374, 404, 434, 464, 494, 524, 554, 584, 614, 644, 674, 704, 733, 763, 793, 823, 853, 883, 913, 943, 973, 1003, 1033],
        [78, 118, 157, 197, 237, 277, 316, 356, 396, 436, 475, 515, 555, 595, 634, 674, 714, 753, 793, 833, 873, 912, 952, 992, 1032, 1071, 1111, 1151, 1191, 1230, 1270, 1310, 1349],
        [107, 162, 217, 272, 327, 382, 437, 492, 547, 602, 657, 712, 767, 822, 877, 932, 987, 1042, 1097, 1152, 1206, 1261, 1316, 1371, 1426, 1481, 1536, 1591, 1646, 1701, 1756, 1811, 1866],
        [142, 244, 347, 449, 552, 654, 757, 859, 962, 1064, 1167, 1269, 1372, 1474, 1577, 1679, 1781, 1884, 1986, 2089, 2191, 2294, 2396, 2487, 2579, 2666, 2749, 2824, 2893, 2957, 3017, 3074, 3129],
    ],
    [
        [63, 93, 123, 152, 182, 212, 242, 272, 302, 331, 361, 391, 421, 451, 481, 510, 540, 570, 600, 630, 660, 689, 719, 749, 779, 809, 839, 868, 898, 928, 958, 988, 1017],
        [66, 106, 145, 185, 225, 264, 304, 344, 384, 423, 463, 503, 542, 582, 622, 661, 701, 741, 781, 820, 860, 900, 939, 979, 1019, 1058, 1098, 1138, 1178, 1217, 1257, 1297, 1336],
        [89, 144, 199, 254, 309, 364, 419, 475, 530, 585, 640, 695, 750, 805, 860, 915, 970, 1025, 1080, 1135, 1191, 1246, 1301, 1356, 1411, 1466, 1521, 1576, 1631, 1686, 1741, 1796, 1851],
        [128, 231, 334, 436, 539, 642, 745, 847, 950, 1053, 1156, 1258, 1361, 1464, 1567, 1669, 1772, 1875, 1978, 2080, 2183, 2286, 2389, 2481, 2573, 2661, 2744, 2820, 2887, 2950, 3009, 3064, 3117],
    ],
];

pub struct Sens {
    /// Voltage at each pad, from the circuit (V).
    pub volts: [f64; PADS],
    regs: std::collections::HashMap<u32, u32>,
}

impl Default for Sens {
    fn default() -> Self {
        Self { volts: [0.0; PADS], regs: Default::default() }
    }
}

/// 12-bit reading of `volts` on ADC `unit` (0 or 1) at attenuation `atten`: the calibration
/// curve run backwards, interpolating between its points.
pub fn raw12(unit: usize, atten: usize, volts: f64) -> u32 {
    let curve = &CURVE_MV[unit][atten];
    let mv = volts * 1000.0;
    let raw_at = |i: usize| (i as f64 * 128.0).min(4095.0);
    if mv <= curve[0] as f64 {
        return 0;
    }
    for i in 1..curve.len() {
        let (lo, hi) = (curve[i - 1] as f64, curve[i] as f64);
        if mv <= hi {
            return (raw_at(i - 1) + (mv - lo) / (hi - lo) * (raw_at(i) - raw_at(i - 1))).round() as u32;
        }
    }
    4095
}

impl Sens {
    fn reg(&self, off: u32) -> u32 {
        self.regs.get(&off).copied().unwrap_or(0)
    }

    /// Result word for a conversion on `unit` with the channel bitmap in `start`.
    fn convert(&self, unit: usize, start: u32) -> u32 {
        let pads: &[usize] = if unit == 0 { &ADC1_GPIO } else { &ADC2_GPIO };
        let map = (start >> EN_PAD_SHIFT) & 0xfff;
        // Only one channel is ever selected; take the lowest
        let Some(ch) = (0..pads.len()).find(|c| map & (1 << c) != 0) else { return 0 };
        let atten = ((self.reg(if unit == 0 { ATTEN1 } else { ATTEN2 }) >> (2 * ch)) & 3) as usize;
        let bits = 9 + ((self.reg(START_FORCE) >> (2 * unit)) & 3);
        let max = (1 << bits) - 1;
        let raw = raw12(unit, atten, self.volts[pads[ch]]) >> (12 - bits);
        // The SAR's own output is inverted; DATA_INV (which ESP-IDF always sets) undoes it
        let inv = if unit == 0 { self.reg(READ_CTRL) & SAR1_DATA_INV } else { self.reg(READ_CTRL2) & SAR2_DATA_INV };
        if inv != 0 { raw } else { max - raw }
    }

    pub fn read(&self, off: u32) -> u32 {
        self.reg(off)
    }

    pub fn write(&mut self, off: u32, v: u32) {
        let unit = match off {
            MEAS_START1 => 0,
            MEAS_START2 => 1,
            _ => {
                self.regs.insert(off, v);
                return;
            }
        };
        let prev = self.reg(off);
        // DATA and DONE are read-only; a rising START runs a conversion, START low clears DONE
        let mut next = (v & !(DATA_MASK | DONE)) | (prev & (DATA_MASK | DONE));
        if v & START == 0 {
            next &= !DONE;
        } else if prev & START == 0 {
            next = (next & !DATA_MASK) | DONE | self.convert(unit, v);
        }
        self.regs.insert(off, next);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(s: &mut Sens, unit: usize, ch: u32) -> u32 {
        let off = if unit == 0 { MEAS_START1 } else { MEAS_START2 };
        s.write(off, 1 << (EN_PAD_SHIFT + ch));
        s.write(off, START | 1 << (EN_PAD_SHIFT + ch));
        let v = s.read(off);
        assert!(v & DONE != 0);
        v & DATA_MASK
    }

    #[test]
    fn converts_the_pad_voltage() {
        let mut s = Sens::default();
        s.write(READ_CTRL, SAR1_DATA_INV);
        s.write(START_FORCE, 3); // 12 bits
        s.write(ATTEN1, 3 << 12); // channel 6 (GPIO34) at 11 dB
        s.volts[34] = 1.65;
        // On the straight part: about 0.8 mV per step above the 142 mV offset
        assert_eq!(read(&mut s, 0, 6), raw12(0, 3, 1.65));
        assert!((raw12(0, 3, 1.65) as i32 - 1884).abs() <= 2);
        // Below the offset nothing, above ~3.13 V full scale
        s.volts[34] = 0.1;
        assert_eq!(read(&mut s, 0, 6), 0);
        s.volts[34] = 3.2;
        assert_eq!(read(&mut s, 0, 6), 4095);
    }

    #[test]
    fn without_data_inv_the_reading_is_inverted() {
        let mut s = Sens::default();
        s.write(START_FORCE, 3);
        s.write(ATTEN1, 3 << 12);
        s.volts[34] = 0.0;
        assert_eq!(read(&mut s, 0, 6), 4095);
    }

    #[test]
    fn follows_the_calibration_curve_back() {
        for unit in 0..2 {
            for atten in 0..4 {
                for (i, &mv) in CURVE_MV[unit][atten].iter().enumerate().skip(1) {
                    let raw = raw12(unit, atten, mv as f64 / 1000.0) as f64;
                    assert!((raw - (i as f64 * 128.0).min(4095.0)).abs() <= 3.0, "unit {unit} atten {atten} point {i}");
                }
            }
        }
    }

    #[test]
    fn narrower_bit_widths_drop_low_bits() {
        let mut s = Sens::default();
        s.write(READ_CTRL, SAR1_DATA_INV);
        s.write(START_FORCE, 0); // 9 bits
        s.write(ATTEN1, 3 << 12);
        s.volts[34] = 1.65;
        assert_eq!(read(&mut s, 0, 6), raw12(0, 3, 1.65) >> 3);
    }

    #[test]
    fn adc2_reads_its_own_pads() {
        let mut s = Sens::default();
        s.write(READ_CTRL2, SAR2_DATA_INV);
        s.write(START_FORCE, 3 << 2);
        s.write(ATTEN2, 3 << 16); // channel 8 (GPIO25)
        s.volts[25] = 2.0;
        assert_eq!(read(&mut s, 1, 8), raw12(1, 3, 2.0));
    }
}
