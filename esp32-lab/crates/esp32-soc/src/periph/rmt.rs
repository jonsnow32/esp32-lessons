//! Remote control peripheral, transmit side (TRM ch. 15): 8 channels sending the pulse codes
//! held in a shared 512-word RAM. This is what WS2812 ("NeoPixel") drivers use on the ESP32.
//!
//! A channel is not stepped per symbol: it runs from one event to the next (the threshold
//! interrupt the driver refills the RAM on, or the end marker), reading the symbols in between
//! only then. The driver writes the half of the RAM that is not being sent, so this sees what
//! the hardware would. A finished transmission is kept as a pulse train for the circuit.
//! Receive, carrier modulation and loop mode are not modelled.

/// GPIO matrix output signals RMT_SIG_OUT0..7.
pub const SIG_OUT0: u32 = 87;
pub const SIG_OUT7: u32 = 94;

/// REF_TICK is 1 MHz: one tick = 80 APB cycles.
const REF_TICK_APB: u64 = 80;
const WORDS_PER_BLOCK: usize = 64;
const RAM_WORDS: usize = 8 * WORDS_PER_BLOCK;

const CONF0: u32 = 0x20;
const STATUS: u32 = 0x60;
const INT_RAW: u32 = 0xa0;
const INT_ST: u32 = 0xa4;
const INT_ENA: u32 = 0xa8;
const INT_CLR: u32 = 0xac;
const CARRIER_DUTY: u32 = 0xb0;
const TX_LIM: u32 = 0xd0;
const APB_CONF: u32 = 0xf0;
const DATE: u32 = 0xfc;
pub const RAM: u32 = 0x800;

const CONF1_TX_START: u32 = 1 << 0;
const CONF1_MEM_RD_RST: u32 = 1 << 3;
const CONF1_REF_ALWAYS_ON: u32 = 1 << 17;
const CONF1_IDLE_OUT_LV: u32 = 1 << 18;
const CONF1_IDLE_OUT_EN: u32 = 1 << 19;
const APB_CONF_TX_WRAP: u32 = 1 << 1;

/// A finished transmission: alternating levels with their durations, as the pad put them out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Frame {
    pub channel: usize,
    /// APB cycle the first pulse started on.
    pub start_apb: u64,
    /// (level, duration in ns); neighbours always have different levels.
    pub pulses: Vec<(bool, u32)>,
}

/// A channel that is sending.
struct Tx {
    /// RAM word of the next symbol to send.
    addr: usize,
    /// Symbols sent since the start, for the threshold interrupt.
    sent: u32,
    /// APB cycle the symbol at `addr` starts on.
    at: u64,
    frame: Frame,
}

/// What the channel reaches next.
struct Next {
    /// Symbols that are sent completely before it.
    symbols: u32,
    apb: u64,
    /// The end marker (else the threshold).
    end: bool,
}

pub struct Rmt {
    /// [channel]: conf0, conf1.
    conf: [[u32; 2]; 8],
    carrier: [u32; 8],
    tx_lim: [u32; 8],
    apb_conf: u32,
    int_raw: u32,
    int_ena: u32,
    pub ram: [u32; RAM_WORDS],
    tx: [Option<Tx>; 8],
    /// Finished transmissions, oldest first, until the host takes them.
    pub frames: Vec<Frame>,
}

impl Default for Rmt {
    fn default() -> Self {
        Self {
            // Reset: divider 2, one block per channel, memory powered
            conf: [[2 | (1 << 24), 0]; 8],
            carrier: [0x0040_0040; 8],
            tx_lim: [0x80; 8],
            apb_conf: 0,
            int_raw: 0,
            int_ena: 0,
            ram: [0; RAM_WORDS],
            tx: Default::default(),
            frames: Vec::new(),
        }
    }
}

impl Rmt {
    pub fn read(&self, off: u32) -> u32 {
        match off {
            CONF0..STATUS => self.conf[((off - CONF0) / 8) as usize][((off / 4) & 1) as usize],
            STATUS..INT_RAW => {
                // Read address [21:12] relative to the RAM, state [26:24] (1 = sending)
                let ch = ((off - STATUS) / 4 % 8) as usize;
                match &self.tx[ch] {
                    Some(t) => ((t.addr as u32) << 12) | (1 << 24),
                    None => 0,
                }
            }
            INT_RAW => self.int_raw,
            INT_ST => self.int_raw & self.int_ena,
            INT_ENA => self.int_ena,
            CARRIER_DUTY..TX_LIM => self.carrier[((off - CARRIER_DUTY) / 4) as usize],
            TX_LIM..APB_CONF => self.tx_lim[((off - TX_LIM) / 4) as usize],
            APB_CONF => self.apb_conf,
            DATE => 0x1606_1700,
            RAM.. if off < RAM + 4 * RAM_WORDS as u32 => self.ram[((off - RAM) / 4) as usize],
            _ => 0,
        }
    }

    pub fn write(&mut self, off: u32, v: u32, apb: u64) {
        match off {
            CONF0..STATUS => {
                let ch = ((off - CONF0) / 8) as usize;
                let r = ((off / 4) & 1) as usize;
                // Start and reset bits do their job and read back as 0
                self.conf[ch][r] = if r == 1 { v & !(CONF1_TX_START | 0x1c) } else { v };
                if r == 1 && v & CONF1_TX_START != 0 {
                    self.start(ch, apb);
                } else if r == 1 && v & CONF1_MEM_RD_RST != 0 {
                    self.tx[ch] = None;
                }
            }
            INT_ENA => self.int_ena = v,
            INT_CLR => self.int_raw &= !v,
            CARRIER_DUTY..TX_LIM => self.carrier[((off - CARRIER_DUTY) / 4) as usize] = v,
            TX_LIM..APB_CONF => self.tx_lim[((off - TX_LIM) / 4) as usize] = v & 0x1ff,
            APB_CONF => self.apb_conf = v,
            RAM.. if off < RAM + 4 * RAM_WORDS as u32 => self.ram[((off - RAM) / 4) as usize] = v,
            _ => {}
        }
    }

    fn start(&mut self, ch: usize, apb: u64) {
        let frame = Frame { channel: ch, start_apb: apb, pulses: Vec::new() };
        self.tx[ch] = Some(Tx { addr: ch * WORDS_PER_BLOCK, sent: 0, at: apb, frame });
    }

    /// APB cycles per tick of channel `ch`.
    fn tick_apb(&self, ch: usize) -> u64 {
        let div = match self.conf[ch][0] & 0xff {
            0 => 256,
            d => d as u64,
        };
        if self.conf[ch][1] & CONF1_REF_ALWAYS_ON != 0 { div } else { div * REF_TICK_APB }
    }

    /// RAM words of channel `ch`: from its own block over `mem_size` blocks.
    fn span(&self, ch: usize) -> (usize, usize) {
        let blocks = ((self.conf[ch][0] >> 24) & 0xf).max(1) as usize;
        let start = ch * WORDS_PER_BLOCK;
        (start, (start + blocks * WORDS_PER_BLOCK).min(RAM_WORDS))
    }

    fn step(&self, ch: usize, addr: usize) -> Option<usize> {
        let (start, end) = self.span(ch);
        match addr + 1 {
            a if a < end => Some(a),
            _ if self.apb_conf & APB_CONF_TX_WRAP != 0 => Some(start),
            // Off the end of its memory without an end marker: the hardware stops
            _ => None,
        }
    }

    /// The next event of a sending channel, from the RAM as it is now.
    fn next(&self, ch: usize) -> Option<Next> {
        let t = self.tx[ch].as_ref()?;
        let tick = self.tick_apb(ch);
        let lim = self.tx_lim[ch];
        let (mut addr, mut apb, mut n) = (t.addr, t.at, 0u32);
        // Never more than one full pass over the channel's memory between two events
        for _ in 0..RAM_WORDS {
            let w = self.ram[addr];
            let (d0, d1) = ((w & 0x7fff) as u64, ((w >> 16) & 0x7fff) as u64);
            if d0 == 0 {
                return Some(Next { symbols: n, apb, end: true });
            }
            if d1 == 0 {
                return Some(Next { symbols: n, apb: apb + d0 * tick, end: true });
            }
            apb += (d0 + d1) * tick;
            n += 1;
            if lim != 0 && (t.sent + n) % lim == 0 {
                return Some(Next { symbols: n, apb, end: false });
            }
            match self.step(ch, addr) {
                Some(a) => addr = a,
                None => return Some(Next { symbols: n, apb, end: true }),
            }
        }
        Some(Next { symbols: n, apb, end: false })
    }

    pub fn update(&mut self, apb: u64) {
        for ch in 0..8 {
            while let Some(next) = self.next(ch).filter(|n| n.apb <= apb) {
                self.advance(ch, next);
            }
        }
    }

    /// Send the symbols up to `next` and raise its interrupt.
    fn advance(&mut self, ch: usize, next: Next) {
        let tick_ns = self.tick_apb(ch) as f64 * 12.5;
        let mut t = self.tx[ch].take().unwrap();
        let mut addr = t.addr;
        let mut push = |level: bool, ticks: u32| {
            let ns = (ticks as f64 * tick_ns).round() as u32;
            match t.frame.pulses.last_mut() {
                Some((l, d)) if *l == level => *d += ns,
                _ => t.frame.pulses.push((level, ns)),
            }
        };
        for _ in 0..next.symbols {
            let w = self.ram[addr];
            push(w & (1 << 15) != 0, w & 0x7fff);
            push(w & (1 << 31) != 0, (w >> 16) & 0x7fff);
            addr = self.step(ch, addr).unwrap_or(addr);
        }
        if next.end {
            let w = self.ram[addr];
            if w & 0x7fff != 0 {
                push(w & (1 << 15) != 0, w & 0x7fff);
            }
            self.int_raw |= 1 << (3 * ch);
            self.frames.push(t.frame);
        } else {
            self.int_raw |= 1 << (24 + ch);
            t.addr = addr;
            t.sent += next.symbols;
            t.at = next.apb;
            self.tx[ch] = Some(t);
        }
    }

    pub fn apb_until_event(&self, apb: u64) -> Option<u64> {
        (0..8).filter_map(|ch| self.next(ch)).map(|n| n.apb.saturating_sub(apb)).min()
    }

    pub fn irq(&self) -> bool {
        self.int_raw & self.int_ena != 0
    }

    /// Level of signal RMT_SIG_OUTn while the channel is not sending: its idle level.
    pub fn idle_level(&self, sig: u32) -> bool {
        let conf1 = self.conf[(sig - SIG_OUT0) as usize][1];
        conf1 & CONF1_IDLE_OUT_EN != 0 && conf1 & CONF1_IDLE_OUT_LV != 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A symbol: `h` ticks HIGH then `l` ticks LOW.
    fn sym(h: u32, l: u32) -> u32 {
        h | (1 << 15) | (l << 16)
    }

    /// Channel 0 at 10 MHz (APB / 8), one block, wrap on, threshold at half the block.
    fn setup() -> Rmt {
        let mut r = Rmt::default();
        r.write(CONF0, 8 | (1 << 24), 0);
        r.write(CONF0 + 4, CONF1_REF_ALWAYS_ON | CONF1_IDLE_OUT_EN, 0);
        r.write(TX_LIM, 32, 0);
        r.write(APB_CONF, APB_CONF_TX_WRAP, 0);
        r.write(INT_ENA, 1 | (1 << 24), 0);
        r
    }

    #[test]
    fn short_frame_ends_at_the_marker() {
        let mut r = setup();
        // WS2812 at 10 MHz: 1 = 8 + 4 ticks, 0 = 4 + 8 ticks
        r.write(RAM, sym(8, 4), 0);
        r.write(RAM + 4, sym(4, 8), 0);
        r.write(RAM + 8, 0, 0);
        r.write(CONF0 + 4, CONF1_REF_ALWAYS_ON | CONF1_IDLE_OUT_EN | CONF1_TX_START, 1000);
        // Two symbols of 12 ticks × 8 APB cycles
        assert_eq!(r.apb_until_event(1000), Some(192));
        r.update(1191);
        assert!(r.frames.is_empty());
        r.update(1192);
        assert!(r.irq());
        assert_eq!(r.frames[0].pulses, vec![(true, 800), (false, 400), (true, 400), (false, 800)]);
    }

    #[test]
    fn long_frame_refilled_on_the_threshold() {
        let mut r = setup();
        for i in 0..64 {
            r.ram[i] = sym(8, 4);
        }
        r.write(CONF0 + 4, CONF1_REF_ALWAYS_ON | CONF1_IDLE_OUT_EN | CONF1_TX_START, 0);
        // 32 symbols sent: threshold
        r.update(32 * 96);
        assert_eq!(r.int_raw, 1 << 24);
        r.write(INT_CLR, 1 << 24, 0);
        // The driver refills the first half: 10 more symbols, then the end marker
        for i in 0..32 {
            r.ram[i] = if i < 10 { sym(4, 8) } else { 0 };
        }
        r.update(64 * 96);
        assert_eq!(r.int_raw, 1 << 24);
        r.update(74 * 96);
        assert_eq!(r.int_raw & 1, 1);
        let f = &r.frames[0];
        let highs: Vec<u32> = f.pulses.iter().filter(|p| p.0).map(|p| p.1).collect();
        assert_eq!(highs.len(), 74);
        assert_eq!(highs.iter().filter(|&&h| h == 800).count(), 64);
        assert_eq!(highs.iter().filter(|&&h| h == 400).count(), 10);
    }
}
