//! I2C controllers (TRM ch. 11), master mode. Firmware fills the 16-entry command list (RSTART,
//! WRITE, READ, STOP, END) and the TX FIFO, then sets TRANS_START. The bus itself lives outside
//! the chip: the list is handed over as a transaction (`pending`), whoever owns the bus answers
//! with an ACK per written byte and the bytes read, and the controller then finishes the list
//! the way the hardware does — stopping at the first unexpected ACK — raising its interrupts
//! once the bytes would have been clocked out at the configured SCL speed.

use std::collections::VecDeque;

/// GPIO matrix signals: I2CEXT0 SCL / SDA, I2CEXT1 SCL / SDA (same index in and out).
pub const SIG_SCL: [u32; 2] = [29, 95];
pub const SIG_SDA: [u32; 2] = [30, 96];

const SCL_LOW_PERIOD: u32 = 0x00;
const CTR: u32 = 0x04;
const SR: u32 = 0x08;
const FIFO_CONF: u32 = 0x18;
const DATA: u32 = 0x1c;
const INT_RAW: u32 = 0x20;
const INT_CLR: u32 = 0x24;
const INT_ENA: u32 = 0x28;
const INT_STATUS: u32 = 0x2c;
const SCL_HIGH_PERIOD: u32 = 0x38;
const COMD0: u32 = 0x58;
const COMD15: u32 = 0x94;

const CTR_TRANS_START: u32 = 1 << 5;
const FIFO_TX_RST: u32 = 1 << 13;
const FIFO_RX_RST: u32 = 1 << 12;
const CMD_DONE: u32 = 1 << 31;

const INT_END_DETECT: u32 = 1 << 3;
const INT_MASTER_TRAN_COMP: u32 = 1 << 6;
const INT_TRANS_COMPLETE: u32 = 1 << 7;
const INT_ACK_ERR: u32 = 1 << 10;

const FIFO_LEN: usize = 32;
/// 100 kHz at APB 80 MHz, when the firmware has not set the SCL periods.
const DEFAULT_BIT_APB: u64 = 800;

const OP_RSTART: u32 = 0;
const OP_WRITE: u32 = 1;
const OP_READ: u32 = 2;
const OP_STOP: u32 = 3;
const OP_END: u32 = 4;

/// One step of a command list, as the bus sees it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Op {
    Start,
    /// Bytes clocked out; with `ack_check` the controller stops at the first ACK that differs
    /// from `ack_exp` (false = ACK expected).
    Write { bytes: Vec<u8>, ack_check: bool, ack_exp: bool },
    /// Bytes clocked in; the controller answers each with `nack` (true on the last byte of a read).
    Read { len: u8, nack: bool },
    Stop,
    /// Pause: the list ends without a STOP and continues with the next TRANS_START.
    End,
}

/// What the bus answered, in op order: per written byte its ACK bit (false = ACK), per read op
/// its bytes.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Reply {
    pub acks: Vec<bool>,
    pub data: Vec<u8>,
}

impl Reply {
    /// No device on the bus: nobody pulls SDA low, so every ACK reads as NACK and every byte as 0xFF.
    pub fn empty(ops: &[Op]) -> Self {
        let mut r = Reply::default();
        for op in ops {
            match op {
                Op::Write { bytes, .. } => r.acks.extend(bytes.iter().map(|_| true)),
                Op::Read { len, .. } => r.data.extend(std::iter::repeat(0xff).take(*len as usize)),
                _ => {}
            }
        }
        r
    }
}

pub struct I2c {
    regs: [u32; 64],
    cmd: [u32; 16],
    tx: VecDeque<u8>,
    rx: VecDeque<u8>,
    int_raw: u32,
    int_ena: u32,
    ack_rec: bool,
    /// Command list waiting for the bus to answer, and the command index of each op.
    pub pending: Option<Vec<Op>>,
    pending_cmds: Vec<usize>,
    started_apb: u64,
    /// The list being clocked out finishes at this APB cycle, raising `finish_int`.
    busy_until: Option<u64>,
    finish_int: u32,
}

impl Default for I2c {
    fn default() -> Self {
        Self {
            regs: [0; 64],
            cmd: [0; 16],
            tx: VecDeque::new(),
            rx: VecDeque::new(),
            int_raw: 0,
            int_ena: 0,
            ack_rec: false,
            pending: None,
            pending_cmds: vec![],
            started_apb: 0,
            busy_until: None,
            finish_int: 0,
        }
    }
}

impl I2c {
    pub fn read(&mut self, off: u32) -> u32 {
        match off {
            SR => {
                let busy = self.pending.is_some() || self.busy_until.is_some();
                (self.ack_rec as u32) | ((busy as u32) << 4) | ((self.rx.len() as u32) << 8) | ((self.tx.len() as u32) << 18)
            }
            DATA => self.rx.pop_front().unwrap_or(0) as u32,
            INT_RAW => self.int_raw,
            INT_ENA => self.int_ena,
            INT_STATUS => self.int_raw & self.int_ena,
            COMD0..=COMD15 => self.cmd[((off - COMD0) / 4) as usize],
            _ => self.regs.get((off / 4) as usize).copied().unwrap_or(0),
        }
    }

    pub fn write(&mut self, off: u32, v: u32, apb: u64) {
        match off {
            CTR => {
                self.regs[(CTR / 4) as usize] = v & !CTR_TRANS_START;
                if v & CTR_TRANS_START != 0 {
                    self.start(apb);
                }
            }
            FIFO_CONF => {
                if v & FIFO_TX_RST != 0 {
                    self.tx.clear();
                }
                if v & FIFO_RX_RST != 0 {
                    self.rx.clear();
                }
                self.regs[(FIFO_CONF / 4) as usize] = v & !(FIFO_TX_RST | FIFO_RX_RST);
            }
            DATA => {
                if self.tx.len() < FIFO_LEN {
                    self.tx.push_back(v as u8);
                }
            }
            INT_CLR => self.int_raw &= !v,
            INT_ENA => self.int_ena = v,
            COMD0..=COMD15 => self.cmd[((off - COMD0) / 4) as usize] = v,
            _ => {
                if let Some(r) = self.regs.get_mut((off / 4) as usize) {
                    *r = v;
                }
            }
        }
    }

    /// TRANS_START: collect the command list up to its STOP or END as bus operations.
    fn start(&mut self, apb: u64) {
        let mut ops = vec![];
        let mut cmds = vec![];
        for (i, &c) in self.cmd.iter().enumerate() {
            let len = (c & 0xff) as usize;
            let op = match (c >> 11) & 7 {
                OP_RSTART => Op::Start,
                OP_WRITE => {
                    let bytes = (0..len).map(|_| self.tx.pop_front().unwrap_or(0xff)).collect();
                    Op::Write { bytes, ack_check: c & (1 << 8) != 0, ack_exp: c & (1 << 9) != 0 }
                }
                OP_READ => Op::Read { len: len as u8, nack: c & (1 << 10) != 0 },
                OP_STOP => Op::Stop,
                OP_END => Op::End,
                _ => break,
            };
            let last = matches!(op, Op::Stop | Op::End);
            ops.push(op);
            cmds.push(i);
            if last {
                break;
            }
        }
        self.pending = Some(ops);
        self.pending_cmds = cmds;
        self.started_apb = apb;
    }

    /// SCL period in APB cycles from the configured low and high periods.
    fn bit_apb(&self) -> u64 {
        let low = self.regs[(SCL_LOW_PERIOD / 4) as usize] as u64 & 0x3fff;
        let high = self.regs[(SCL_HIGH_PERIOD / 4) as usize] as u64 & 0x3fff;
        if low + high == 0 { DEFAULT_BIT_APB } else { low + 1 + high + 1 }
    }

    /// Finish the pending list with the bus's answer.
    pub fn resolve(&mut self, reply: &Reply) {
        let Some(ops) = self.pending.take() else { return };
        let cmds = std::mem::take(&mut self.pending_cmds);
        let mut acks = reply.acks.iter().copied();
        let mut data = reply.data.iter().copied();
        let mut bits = 0u64;
        let mut int = 0;
        'list: for (op, &ci) in ops.iter().zip(&cmds) {
            match op {
                Op::Start => bits += 1,
                Op::Write { bytes, ack_check, ack_exp } => {
                    for _ in bytes {
                        bits += 9;
                        self.ack_rec = acks.next().unwrap_or(true);
                        if *ack_check && self.ack_rec != *ack_exp {
                            int = INT_ACK_ERR;
                            break 'list;
                        }
                    }
                }
                Op::Read { len, .. } => {
                    for _ in 0..*len {
                        bits += 9;
                        let b = data.next().unwrap_or(0xff);
                        if self.rx.len() < FIFO_LEN {
                            self.rx.push_back(b);
                        }
                    }
                }
                Op::Stop => {
                    bits += 1;
                    int = INT_TRANS_COMPLETE | INT_MASTER_TRAN_COMP;
                }
                Op::End => int = INT_END_DETECT,
            }
            self.cmd[ci] |= CMD_DONE;
        }
        self.busy_until = Some(self.started_apb + bits.max(1) * self.bit_apb());
        self.finish_int = int;
    }

    pub fn update(&mut self, apb: u64) {
        if self.busy_until.is_some_and(|t| apb >= t) {
            self.busy_until = None;
            self.int_raw |= self.finish_int;
        }
    }

    pub fn apb_until_event(&self, apb: u64) -> Option<u64> {
        self.busy_until.map(|t| t.saturating_sub(apb))
    }

    pub fn irq(&self) -> bool {
        self.int_raw & self.int_ena != 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cmd(op: u32, len: u32, flags: u32) -> u32 {
        (op << 11) | flags | len
    }

    /// The command list i2c_master_transmit builds for a 2-byte write to 0x27.
    fn write_two(i: &mut I2c) {
        for b in [0x27 << 1, 0xaa, 0x55] {
            i.write(DATA, b, 0);
        }
        i.write(COMD0, cmd(OP_RSTART, 0, 0), 0);
        i.write(COMD0 + 4, cmd(OP_WRITE, 3, 1 << 8), 0);
        i.write(COMD0 + 8, cmd(OP_STOP, 0, 0), 0);
        i.write(INT_ENA, INT_TRANS_COMPLETE | INT_ACK_ERR, 0);
        i.write(CTR, CTR_TRANS_START | 0x13, 1000);
    }

    #[test]
    fn hands_the_list_to_the_bus_and_completes_after_the_bits() {
        let mut i = I2c::default();
        write_two(&mut i);
        assert_eq!(
            i.pending,
            Some(vec![Op::Start, Op::Write { bytes: vec![0x4e, 0xaa, 0x55], ack_check: true, ack_exp: false }, Op::Stop])
        );
        assert_ne!(i.read(SR) & (1 << 4), 0, "bus busy");
        i.resolve(&Reply { acks: vec![false; 3], data: vec![] });
        // 1 + 27 + 1 bits at 100 kHz
        assert_eq!(i.apb_until_event(1000), Some(29 * DEFAULT_BIT_APB));
        i.update(1000 + 29 * DEFAULT_BIT_APB - 1);
        assert!(!i.irq());
        i.update(1000 + 29 * DEFAULT_BIT_APB);
        assert_eq!(i.read(INT_STATUS), INT_TRANS_COMPLETE);
        assert_ne!(i.read(COMD0 + 8) & CMD_DONE, 0);
    }

    #[test]
    fn stops_at_a_nack() {
        let mut i = I2c::default();
        write_two(&mut i);
        let ops = i.pending.clone().unwrap();
        i.resolve(&Reply::empty(&ops));
        i.update(u64::MAX);
        assert_eq!(i.read(INT_STATUS), INT_ACK_ERR);
        assert_eq!(i.read(COMD0 + 8) & CMD_DONE, 0, "STOP not reached");
    }

    #[test]
    fn reads_land_in_the_rx_fifo() {
        let mut i = I2c::default();
        i.write(DATA, (0x3c << 1) | 1, 0);
        i.write(COMD0, cmd(OP_RSTART, 0, 0), 0);
        i.write(COMD0 + 4, cmd(OP_WRITE, 1, 1 << 8), 0);
        i.write(COMD0 + 8, cmd(OP_READ, 2, 0), 0);
        i.write(COMD0 + 12, cmd(OP_READ, 1, 1 << 10), 0);
        i.write(COMD0 + 16, cmd(OP_END, 0, 0), 0);
        i.write(CTR, CTR_TRANS_START, 0);
        assert_eq!(i.pending.as_ref().unwrap()[3], Op::Read { len: 1, nack: true });
        i.resolve(&Reply { acks: vec![false], data: vec![1, 2, 3] });
        i.update(u64::MAX);
        assert_eq!(i.read(INT_RAW), INT_END_DETECT);
        assert_eq!((i.read(SR) >> 8) & 0x3f, 3);
        assert_eq!([i.read(DATA), i.read(DATA), i.read(DATA)], [1, 2, 3]);
    }
}
