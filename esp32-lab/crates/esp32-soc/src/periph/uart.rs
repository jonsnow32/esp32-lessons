//! UART controller (TRM ch. UART). TX bytes leave the FIFO instantly, so the FIFO always reads
//! as empty and TX_DONE is always set; RX is fed by the host.

use std::collections::VecDeque;

const FIFO: u32 = 0x00;
const INT_RAW: u32 = 0x04;
const INT_ST: u32 = 0x08;
const INT_ENA: u32 = 0x0c;
const INT_CLR: u32 = 0x10;
const STATUS: u32 = 0x1c;
const MEM_RX_STATUS: u32 = 0x60;

const INT_RXFIFO_FULL: u32 = 1 << 0;
const INT_TXFIFO_EMPTY: u32 = 1 << 1;
const INT_RXFIFO_TOUT: u32 = 1 << 8;
const INT_TX_DONE: u32 = 1 << 14;

#[derive(Default)]
pub struct Uart {
    pub tx: Vec<u8>,
    pub rx: VecDeque<u8>,
    latched: u32,
    ena: u32,
    regs: std::collections::HashMap<u32, u32>,
}

impl Uart {
    fn raw(&self) -> u32 {
        let mut raw = self.latched | INT_TXFIFO_EMPTY;
        if !self.rx.is_empty() {
            raw |= INT_RXFIFO_FULL | INT_RXFIFO_TOUT;
        }
        raw
    }

    pub fn irq(&self) -> bool {
        self.raw() & self.ena != 0
    }

    pub fn read(&mut self, off: u32) -> u32 {
        match off {
            FIFO => self.rx.pop_front().unwrap_or(0) as u32,
            INT_RAW => self.raw(),
            INT_ST => self.raw() & self.ena,
            INT_ENA => self.ena,
            // RXFIFO_CNT [7:0], TXFIFO_CNT [23:16] = 0, ST_UTX_OUT idle
            STATUS => (self.rx.len().min(127) as u32) | (1 << 29),
            MEM_RX_STATUS => 0,
            _ => self.regs.get(&off).copied().unwrap_or(0),
        }
    }

    pub fn write(&mut self, off: u32, v: u32) {
        match off {
            FIFO => {
                self.tx.push(v as u8);
                self.latched |= INT_TX_DONE;
            }
            INT_ENA => self.ena = v,
            INT_CLR => self.latched &= !v,
            _ => {
                self.regs.insert(off, v);
            }
        }
    }
}
