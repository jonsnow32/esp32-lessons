//! MD5 (RFC 1321) in the layout the ESP32 ROM uses (Colin Plumb's MD5Context):
//! `uint32_t buf[4]; uint32_t bits[2]; uint8_t in[64];`, so state lives in guest memory.

pub const CONTEXT_SIZE: usize = 88;

const S: [u32; 64] = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

fn k(i: usize) -> u32 {
    ((i as f64 + 1.0).sin().abs() * 4294967296.0) as u32
}

fn transform(buf: &mut [u32; 4], block: &[u8]) {
    let m: Vec<u32> = block.chunks(4).map(|c| u32::from_le_bytes(c.try_into().unwrap())).collect();
    let [mut a, mut b, mut c, mut d] = *buf;
    for i in 0..64 {
        let (f, g) = match i / 16 {
            0 => ((b & c) | (!b & d), i),
            1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
            2 => (b ^ c ^ d, (3 * i + 5) % 16),
            _ => (c ^ (b | !d), (7 * i) % 16),
        };
        let t = d;
        d = c;
        c = b;
        b = b.wrapping_add(a.wrapping_add(f).wrapping_add(k(i)).wrapping_add(m[g]).rotate_left(S[i]));
        a = t;
    }
    for (x, y) in buf.iter_mut().zip([a, b, c, d]) {
        *x = x.wrapping_add(y);
    }
}

pub struct Context {
    pub buf: [u32; 4],
    pub bits: [u32; 2],
    pub input: [u8; 64],
}

impl Context {
    pub fn new() -> Self {
        Self { buf: [0x6745_2301, 0xefcd_ab89, 0x98ba_dcfe, 0x1032_5476], bits: [0; 2], input: [0; 64] }
    }

    pub fn from_bytes(b: &[u8]) -> Self {
        let w = |i: usize| u32::from_le_bytes(b[4 * i..4 * i + 4].try_into().unwrap());
        let mut input = [0; 64];
        input.copy_from_slice(&b[24..88]);
        Self { buf: [w(0), w(1), w(2), w(3)], bits: [w(4), w(5)], input }
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out: Vec<u8> = self.buf.iter().chain(&self.bits).flat_map(|w| w.to_le_bytes()).collect();
        out.extend_from_slice(&self.input);
        out
    }

    pub fn update(&mut self, mut data: &[u8]) {
        let used = ((self.bits[0] >> 3) & 0x3f) as usize;
        let total = ((self.bits[1] as u64) << 32 | self.bits[0] as u64).wrapping_add((data.len() as u64) << 3);
        self.bits = [total as u32, (total >> 32) as u32];
        let mut fill = used;
        if fill > 0 {
            let take = (64 - fill).min(data.len());
            self.input[fill..fill + take].copy_from_slice(&data[..take]);
            data = &data[take..];
            fill += take;
            if fill < 64 {
                return;
            }
            let block = self.input;
            transform(&mut self.buf, &block);
        }
        while data.len() >= 64 {
            transform(&mut self.buf, &data[..64]);
            data = &data[64..];
        }
        self.input[..data.len()].copy_from_slice(data);
    }

    pub fn finish(mut self) -> [u8; 16] {
        let bits = self.bits;
        let used = ((bits[0] >> 3) & 0x3f) as usize;
        let pad_len = if used < 56 { 56 - used } else { 120 - used };
        let mut pad = vec![0u8; pad_len];
        pad[0] = 0x80;
        self.update(&pad);
        let mut len = [0u8; 8];
        len[..4].copy_from_slice(&bits[0].to_le_bytes());
        len[4..].copy_from_slice(&bits[1].to_le_bytes());
        self.update(&len);
        let mut out = [0u8; 16];
        for (k, w) in self.buf.iter().enumerate() {
            out[4 * k..4 * k + 4].copy_from_slice(&w.to_le_bytes());
        }
        out
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn rfc1321_vectors() {
        let hex = |d: [u8; 16]| d.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let mut c = super::Context::new();
        c.update(b"abc");
        assert_eq!(hex(c.finish()), "900150983cd24fb0d6963f7d28e17f72");
        let mut c = super::Context::new();
        for chunk in b"12345678901234567890123456789012345678901234567890123456789012345678901234567890".chunks(7) {
            c.update(chunk);
        }
        assert_eq!(hex(c.finish()), "57edf4a22be3c955ac49da2e2107b67a");
    }
}
