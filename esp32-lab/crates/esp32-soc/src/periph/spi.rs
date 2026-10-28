//! SPI0/SPI1 flash controller (TRM ch. SPI) talking to a 4 MB Winbond W25Q32-style flash chip.
//! Both the "native" command bits (FLASH_PP, FLASH_SE, ...) and user-defined transactions
//! (command + address + MOSI/MISO through W0..W15) are supported. Operations complete
//! instantly, so the busy bit never reads set.

use crate::flash::Flash;

const CMD: u32 = 0x00;
const ADDR: u32 = 0x04;
const RD_STATUS: u32 = 0x10;
const USER: u32 = 0x1c;
const USER1: u32 = 0x20;
const USER2: u32 = 0x24;
const MOSI_DLEN: u32 = 0x28;
const MISO_DLEN: u32 = 0x2c;
const W0: u32 = 0x80;

const FLASH_READ: u32 = 1 << 31;
const FLASH_WREN: u32 = 1 << 30;
const FLASH_WRDI: u32 = 1 << 29;
const FLASH_RDID: u32 = 1 << 28;
const FLASH_RDSR: u32 = 1 << 27;
const FLASH_WRSR: u32 = 1 << 26;
const FLASH_PP: u32 = 1 << 25;
const FLASH_SE: u32 = 1 << 24;
const FLASH_BE: u32 = 1 << 23;
const FLASH_CE: u32 = 1 << 22;
const FLASH_DP: u32 = 1 << 21;
const FLASH_RES: u32 = 1 << 20;
const USR: u32 = 1 << 18;

const USR_COMMAND: u32 = 1 << 31;
const USR_ADDR: u32 = 1 << 30;
const USR_MISO: u32 = 1 << 28;
const USR_MOSI: u32 = 1 << 27;

/// JEDEC ID as read back in W0: manufacturer 0xEF, type 0x40, capacity 0x16 (4 MB).
pub const JEDEC_ID: u32 = 0x0016_40ef;

pub struct Spi {
    regs: [u32; 64],
    write_enabled: bool,
    status: u32,
    /// Number of program/erase operations, for tests and diagnostics.
    pub writes: u64,
}

impl Default for Spi {
    fn default() -> Self {
        Self { regs: [0; 64], write_enabled: false, status: 0, writes: 0 }
    }
}

impl Spi {
    pub fn read(&self, off: u32) -> u32 {
        self.regs[(off as usize / 4) & 63]
    }

    /// Returns true when a command was started and must be executed against the flash.
    pub fn write(&mut self, off: u32, v: u32) -> bool {
        self.regs[(off as usize / 4) & 63] = v;
        off == CMD && v != 0
    }

    fn w(&self, k: usize) -> u32 {
        self.regs[(W0 as usize / 4) + k]
    }

    fn set_w_bytes(&mut self, data: &[u8]) {
        for (k, chunk) in data.chunks(4).take(16).enumerate() {
            let mut b = [0u8; 4];
            b[..chunk.len()].copy_from_slice(chunk);
            self.regs[(W0 as usize / 4) + k] = u32::from_le_bytes(b);
        }
    }

    fn w_bytes(&self, len: usize) -> Vec<u8> {
        (0..len.min(64)).map(|k| (self.w(k / 4) >> (8 * (k % 4))) as u8).collect()
    }

    fn erase(&mut self, flash: &mut Flash, addr: usize, len: usize) {
        if self.write_enabled {
            flash.erase(addr & !(len - 1), len);
            self.writes += 1;
        }
        self.write_enabled = false;
    }

    fn program(&mut self, flash: &mut Flash, addr: usize, data: &[u8]) {
        if self.write_enabled {
            // Page program wraps within the 256-byte page
            let page = addr & !0xff;
            for (k, &b) in data.iter().enumerate() {
                flash.program(page + ((addr + k) & 0xff), &[b]);
            }
            self.writes += 1;
        }
        self.write_enabled = false;
    }

    /// One flash command with optional address and data phases; returns MISO bytes.
    fn transact(&mut self, flash: &mut Flash, cmd: u8, addr: usize, mosi: &[u8], miso_len: usize) -> Vec<u8> {
        let read = |a: usize, n: usize| (0..n).map(|k| flash.data.get((a + k) % flash.data.len()).copied().unwrap_or(0xff)).collect::<Vec<u8>>();
        match cmd {
            // READ, FAST_READ, DOUT, DIO, QOUT, QIO
            0x03 | 0x0b | 0x3b | 0xbb | 0x6b | 0xeb => return read(addr, miso_len),
            0x06 => self.write_enabled = true,
            0x04 => self.write_enabled = false,
            0x05 => return vec![(self.write_enabled as u8) << 1; miso_len.max(1)],
            0x35 | 0x15 => return vec![(self.status >> 8) as u8; miso_len.max(1)],
            0x01 | 0x31 => {
                if let Some(&b) = mosi.first() {
                    self.status = b as u32 | ((mosi.get(1).copied().unwrap_or(0) as u32) << 8);
                }
                self.write_enabled = false;
            }
            0x9f => return JEDEC_ID.to_le_bytes()[..3].iter().copied().chain(std::iter::repeat(0)).take(miso_len.max(3)).collect(),
            0x02 => {
                let data = mosi.to_vec();
                self.program(flash, addr, &data);
            }
            0x20 => self.erase(flash, addr, 0x1000),
            0x52 => self.erase(flash, addr, 0x8000),
            0xd8 => self.erase(flash, addr, 0x1_0000),
            0x60 | 0xc7 => {
                let n = flash.data.len();
                self.erase(flash, 0, n);
            }
            // Unique ID / SFDP: return a fixed, plausible answer
            0x4b => return vec![0x5a; miso_len],
            _ => {}
        }
        vec![0; miso_len]
    }

    pub fn execute(&mut self, flash: &mut Flash) {
        let cmd = self.regs[0];
        let addr_reg = self.regs[(ADDR / 4) as usize];
        if cmd & USR != 0 {
            let user = self.regs[(USER / 4) as usize];
            let user2 = self.regs[(USER2 / 4) as usize];
            let command = if user & USR_COMMAND != 0 { (user2 & 0xffff) as u8 } else { 0 };
            let addr = if user & USR_ADDR != 0 {
                // User-mode addresses are left-aligned in SPI_ADDR (spi_flash_ll_set_usr_address)
                let bits = ((self.regs[(USER1 / 4) as usize] >> 26) & 0x3f) + 1;
                (if bits >= 32 { addr_reg } else { addr_reg >> (32 - bits) }) as usize
            } else {
                0
            };
            let mosi_len = if user & USR_MOSI != 0 { ((self.regs[(MOSI_DLEN / 4) as usize] & 0xff_ffff) as usize + 1) / 8 } else { 0 };
            let miso_len = if user & USR_MISO != 0 { ((self.regs[(MISO_DLEN / 4) as usize] & 0xff_ffff) as usize + 1) / 8 } else { 0 };
            let mosi = self.w_bytes(mosi_len);
            let out = self.transact(flash, command, addr, &mosi, miso_len);
            if miso_len > 0 {
                self.set_w_bytes(&out);
            }
        } else {
            // Native commands: ADDR[23:0] = address, ADDR[31:24] = byte count where relevant
            let addr = (addr_reg & 0xff_ffff) as usize;
            let len = (addr_reg >> 24) as usize;
            if cmd & FLASH_READ != 0 {
                let data = self.transact(flash, 0x03, addr, &[], len.max(1));
                self.set_w_bytes(&data);
            }
            if cmd & FLASH_WREN != 0 {
                self.transact(flash, 0x06, 0, &[], 0);
            }
            if cmd & FLASH_WRDI != 0 {
                self.transact(flash, 0x04, 0, &[], 0);
            }
            if cmd & FLASH_RDID != 0 {
                self.regs[(W0 / 4) as usize] = JEDEC_ID;
            }
            if cmd & FLASH_RDSR != 0 {
                self.regs[(RD_STATUS / 4) as usize] = self.status | ((self.write_enabled as u32) << 1);
            }
            if cmd & FLASH_WRSR != 0 {
                self.status = self.regs[(RD_STATUS / 4) as usize] & 0xffff;
            }
            if cmd & FLASH_PP != 0 {
                let data = self.w_bytes(len);
                self.program(flash, addr, &data);
            }
            if cmd & FLASH_SE != 0 {
                self.erase(flash, addr, 0x1000);
            }
            if cmd & FLASH_BE != 0 {
                self.erase(flash, addr, 0x1_0000);
            }
            if cmd & FLASH_CE != 0 {
                let n = flash.data.len();
                self.erase(flash, 0, n);
            }
            let _ = (FLASH_DP, FLASH_RES);
        }
        // Done: the controller clears the command bits
        self.regs[0] = 0;
    }
}
