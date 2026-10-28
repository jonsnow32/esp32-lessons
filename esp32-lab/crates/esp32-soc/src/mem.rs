//! ESP32 internal memories and the flash MMU (TRM §1.3 "System and Memory").
//!
//! | Address range            | What                                   |
//! |--------------------------|----------------------------------------|
//! | 0x3F40_0000–0x3F7F_FFFF  | External flash, data bus (DROM), MMU   |
//! | 0x3FF8_0000–0x3FF8_1FFF  | RTC FAST memory, data bus (PRO_CPU)    |
//! | 0x3FFA_E000–0x3FFF_FFFF  | Internal SRAM2 + SRAM1, data bus       |
//! | 0x4000_0000–0x4006_FFFF  | Internal ROM (replaced by HLE)         |
//! | 0x4007_0000–0x4009_FFFF  | Internal SRAM0, instruction bus (IRAM) |
//! | 0x400A_0000–0x400B_FFFF  | SRAM1, instruction bus (word-reversed) |
//! | 0x400C_0000–0x400C_1FFF  | RTC FAST memory, instruction bus       |
//! | 0x400D_0000–0x403F_FFFF  | External flash, instruction bus (IROM) |
//! | 0x5000_0000–0x5000_1FFF  | RTC SLOW memory                        |

use crate::flash::Flash;

pub const IRAM_BASE: u32 = 0x4007_0000;
pub const IRAM_END: u32 = 0x400a_0000;
pub const DRAM_BASE: u32 = 0x3ffa_e000;
pub const DRAM_END: u32 = 0x4000_0000;
pub const SRAM1_IBUS_BASE: u32 = 0x400a_0000;
pub const SRAM1_IBUS_END: u32 = 0x400c_0000;
pub const RTC_FAST_DBUS: u32 = 0x3ff8_0000;
pub const RTC_FAST_IBUS: u32 = 0x400c_0000;
pub const RTC_SLOW_BASE: u32 = 0x5000_0000;
pub const RTC_SIZE: u32 = 0x2000;
pub const ROM_BASE: u32 = 0x4000_0000;
pub const ROM_END: u32 = 0x4007_0000;
pub const DROM_BASE: u32 = 0x3f40_0000;
pub const DROM_END: u32 = 0x3f80_0000;
pub const IROM_BASE: u32 = 0x400d_0000;
pub const IROM_END: u32 = 0x4040_0000;

/// DPORT_PRO_FLASH_MMU_TABLE / DPORT_APP_FLASH_MMU_TABLE
pub const MMU_TABLE: [u32; 2] = [0x3ff1_0000, 0x3ff1_2000];
/// Each table spans 8 KB; only the first 384 entries translate addresses on the ESP32.
pub const MMU_ENTRIES: usize = 2048;
pub const MMU_INVALID: u32 = 0x100;
const PAGE: u32 = 0x1_0000;

pub struct Memory {
    pub iram: Vec<u8>,
    pub dram: Vec<u8>,
    pub rtc_fast: Vec<u8>,
    pub rtc_slow: Vec<u8>,
    pub flash: Flash,
    /// Per-CPU flash MMU: entry = 64 KB flash page, or MMU_INVALID.
    pub mmu: [[u32; MMU_ENTRIES]; 2],
}

/// Where an address lands.
pub enum Target<'a> {
    Ram(&'a mut [u8], usize),
    /// Flash through the cache: read-only.
    Flash(usize),
    Rom,
    Mmu(usize, usize),
    Io,
    Unmapped,
}

/// MMU table index for a flash-mapped virtual address.
fn mmu_index(addr: u32) -> Option<usize> {
    match addr {
        DROM_BASE..DROM_END => Some(((addr - DROM_BASE) / PAGE) as usize),
        // IRAM0/IROM0 cache region 0x4000_0000–0x403F_FFFF uses entries 64..127
        IROM_BASE..IROM_END => Some(64 + ((addr - ROM_BASE) / PAGE) as usize),
        _ => None,
    }
}

impl Memory {
    pub fn new(flash: Flash) -> Self {
        Self {
            iram: vec![0; (IRAM_END - IRAM_BASE) as usize],
            dram: vec![0; (DRAM_END - DRAM_BASE) as usize],
            rtc_fast: vec![0; RTC_SIZE as usize],
            rtc_slow: vec![0; RTC_SIZE as usize],
            flash,
            mmu: [[MMU_INVALID; MMU_ENTRIES]; 2],
        }
    }

    /// Map a flash range the way the second-stage bootloader does for the app's flash segments.
    pub fn map_flash(&mut self, vaddr: u32, flash_offset: usize, len: usize) {
        let first = vaddr & !(PAGE - 1);
        let mut page = (flash_offset as u32) / PAGE;
        let mut v = first;
        while v < vaddr + len as u32 {
            if let Some(i) = mmu_index(v) {
                for cpu in 0..2 {
                    self.mmu[cpu][i] = page;
                }
            }
            v += PAGE;
            page += 1;
        }
    }

    pub fn target(&mut self, cpu: usize, addr: u32) -> Target<'_> {
        match addr {
            DRAM_BASE..DRAM_END => Target::Ram(&mut self.dram, (addr - DRAM_BASE) as usize),
            IRAM_BASE..IRAM_END => Target::Ram(&mut self.iram, (addr - IRAM_BASE) as usize),
            SRAM1_IBUS_BASE..SRAM1_IBUS_END => {
                // Instruction-bus view of SRAM1 runs backwards in 4-byte words
                let word = (addr - SRAM1_IBUS_BASE) & !3;
                let data = 0x3fff_fffc - word + (addr & 3);
                Target::Ram(&mut self.dram, (data - DRAM_BASE) as usize)
            }
            RTC_FAST_DBUS..0x3ff8_2000 => Target::Ram(&mut self.rtc_fast, (addr - RTC_FAST_DBUS) as usize),
            RTC_FAST_IBUS..0x400c_2000 => Target::Ram(&mut self.rtc_fast, (addr - RTC_FAST_IBUS) as usize),
            RTC_SLOW_BASE..0x5000_2000 => Target::Ram(&mut self.rtc_slow, (addr - RTC_SLOW_BASE) as usize),
            ROM_BASE..ROM_END => Target::Rom,
            _ if (MMU_TABLE[0]..MMU_TABLE[0] + 4 * MMU_ENTRIES as u32).contains(&addr) => {
                Target::Mmu(0, ((addr - MMU_TABLE[0]) / 4) as usize)
            }
            _ if (MMU_TABLE[1]..MMU_TABLE[1] + 4 * MMU_ENTRIES as u32).contains(&addr) => {
                Target::Mmu(1, ((addr - MMU_TABLE[1]) / 4) as usize)
            }
            0x3ff0_0000..0x3ff8_0000 => Target::Io,
            // AHB alias of the 0x3FF4_0000 peripherals (FIFOs, RNG...)
            0x6000_0000..0x6004_0000 => Target::Io,
            _ => match mmu_index(addr) {
                Some(i) => {
                    let entry = self.mmu[cpu][i];
                    if entry & MMU_INVALID != 0 {
                        Target::Unmapped
                    } else {
                        Target::Flash((entry as usize) * PAGE as usize + (addr % PAGE) as usize)
                    }
                }
                None => Target::Unmapped,
            },
        }
    }
}
