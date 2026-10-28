//! The whole chip: two Xtensa cores sharing memory and peripherals, a global clock, and the
//! boot sequence that stands in for the ROM + second-stage bootloader.

use crate::elf::Elf;
use crate::flash::{self, Flash};
use crate::mem::{Memory, Target, ROM_BASE, ROM_END};
use crate::periph::{Periph, SOURCES};
use crate::rom::Rom;
use xtensa_core::cpu::{PS_CALLINC_SHIFT, PS_WOE};
use xtensa_core::{Bus, BusError, Cpu, Step};

/// CPU clock (CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ = 240). The global clock counts these cycles.
pub const CPU_HZ: u64 = 240_000_000;
/// APB runs at 80 MHz: one APB tick every 3 CPU cycles.
pub const CPU_PER_APB: u64 = 3;
/// Instructions a core runs before the other gets a turn and interrupts are re-evaluated.
const QUANTUM: u64 = 64;

/// Peripherals at 0x6000_0000 are the same registers as at 0x3FF4_0000.
fn io_alias(addr: u32) -> u32 {
    if addr >= 0x6000_0000 { addr - 0x6000_0000 + 0x3ff4_0000 } else { addr }
}

/// One core's view of the address space.
pub struct CoreBus<'a> {
    pub mem: &'a mut Memory,
    pub periph: &'a mut Periph,
    pub cpu: usize,
    pub apb: u64,
}

impl Bus for CoreBus<'_> {
    fn code_generation(&self) -> u64 {
        self.mem.code_generation
    }

    fn fetch(&mut self, addr: u32) -> Result<u32, BusError> {
        // Instructions are at most 3 bytes: read them straight out of RAM or flash
        let bytes: Option<[u8; 3]> = match self.mem.target(self.cpu, addr) {
            Target::Ram(buf, off) if off + 3 <= buf.len() => Some([buf[off], buf[off + 1], buf[off + 2]]),
            Target::Flash(off) => self.mem.flash.data.get(off..off + 3).map(|b| [b[0], b[1], b[2]]),
            _ => None,
        };
        match bytes {
            Some(b) => Ok(u32::from_le_bytes([b[0], b[1], b[2], 0])),
            None => Err(BusError::Unmapped),
        }
    }

    fn read(&mut self, addr: u32, size: u8) -> Result<u32, BusError> {
        let instruction_bus = (0x4000_0000..0x4400_0000).contains(&addr);
        match self.mem.target(self.cpu, addr) {
            Target::Ram(buf, off) => {
                if size == 4 {
                    let b = buf.get(off..off + 4).ok_or(BusError::Unmapped)?;
                    return Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]));
                }
                // IRAM and the flash instruction cache only allow 32-bit accesses
                if instruction_bus {
                    return Err(BusError::BadWidth);
                }
                let mut v = 0u32;
                for k in 0..size as usize {
                    v |= (*buf.get(off + k).ok_or(BusError::Unmapped)? as u32) << (8 * k);
                }
                Ok(v)
            }
            Target::Flash(off) => {
                if instruction_bus && size != 4 {
                    return Err(BusError::BadWidth);
                }
                let d = &self.mem.flash.data;
                let mut v = 0u32;
                for k in 0..size as usize {
                    v |= (*d.get(off + k).unwrap_or(&0xff) as u32) << (8 * k);
                }
                Ok(v)
            }
            Target::Mmu(cpu, i) => Ok(self.mem.mmu[cpu][i]),
            Target::Io => Ok(self.periph.read(io_alias(addr) & !3, self.apb) >> (8 * (addr & 3))),
            // ROM data is not available; code in ROM is handled by HLE before fetch
            Target::Rom => Ok(0),
            Target::Unmapped => Err(BusError::Unmapped),
        }
    }

    fn write(&mut self, addr: u32, size: u8, value: u32) -> Result<(), BusError> {
        let instruction_bus = (0x4000_0000..0x4400_0000).contains(&addr);
        match self.mem.target(self.cpu, addr) {
            Target::Ram(buf, off) => {
                if instruction_bus && size != 4 {
                    return Err(BusError::BadWidth);
                }
                for k in 0..size as usize {
                    *buf.get_mut(off + k).ok_or(BusError::Unmapped)? = (value >> (8 * k)) as u8;
                }
                // Writes through the instruction bus can change code (IRAM, RTC FAST)
                if instruction_bus {
                    self.mem.code_generation += 1;
                }
                Ok(())
            }
            Target::Mmu(cpu, i) => {
                self.mem.mmu[cpu][i] = value & 0x1ff;
                self.mem.code_generation += 1;
                Ok(())
            }
            Target::Io => {
                if let Some(k) = self.periph.write(io_alias(addr) & !3, value, self.apb) {
                    let writes = self.periph.spi[k].writes;
                    self.periph.spi[k].execute(&mut self.mem.flash);
                    if self.periph.spi[k].writes != writes {
                        self.mem.code_generation += 1;
                    }
                }
                Ok(())
            }
            Target::Flash(_) | Target::Rom | Target::Unmapped => Err(BusError::Unmapped),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Stop {
    /// Reached the requested time.
    Timeout,
    /// A pad's drive state changed (only with `stop_on_pad_change`), so the circuit must be
    /// re-solved before going on.
    PadChange,
    Break { cpu: usize, pc: u32, s: u8, t: u8 },
    /// Firmware called a ROM function the HLE layer does not implement.
    Rom(String),
    Reset(String),
}

/// A pad changed: when, which GPIO, its new state.
#[derive(Debug, Clone, Copy)]
pub struct PadEvent {
    pub cycles: u64,
    pub gpio: usize,
    pub state: crate::periph::gpio::PadState,
}

pub struct Soc {
    pub cpus: [Cpu; 2],
    pub running: [bool; 2],
    /// A core in an HLE delay (ets_delay_us) is stalled until this cycle count.
    pub busy_until: [u64; 2],
    pub mem: Memory,
    pub periph: Periph,
    pub rom: Rom,
    pub cycles: u64,
    pub pad_events: Vec<PadEvent>,
    last_pads: [crate::periph::gpio::PadState; crate::periph::gpio::PADS],
    edge_prev: [u32; 2],
    pub exceptions: Vec<(u64, usize, u32, u32)>,
    /// Return Stop::PadChange from `run` as soon as a pad changes (circuit co-simulation).
    pub stop_on_pad_change: bool,
}

impl Soc {
    /// Build the flash image from PlatformIO build outputs and boot the app directly.
    pub fn from_build(elf: &[u8], app_bin: &[u8], bootloader: Option<&[u8]>, partitions: Option<&[u8]>) -> Result<Self, String> {
        let elf = Elf::parse(elf)?;
        let mut flash = Flash::blank();
        if let Some(b) = bootloader {
            flash.write(flash::BOOTLOADER_OFFSET, b);
        }
        if let Some(p) = partitions {
            flash.write(flash::PARTITIONS_OFFSET, p);
        }
        flash.write(flash::APP_OFFSET, app_bin);

        let mut mem = Memory::new(flash);
        let (entry, segments) = flash::parse_app_image(&mem.flash, flash::APP_OFFSET)?;
        let mut periph = Periph::new([0x24, 0x0a, 0xc4, 0x12, 0x34, 0x56]);

        // What the second-stage bootloader does: copy RAM segments, map flash segments
        for seg in &segments {
            let a = seg.load_addr;
            let is_flash = (0x3f40_0000..0x3f80_0000).contains(&a) || (0x400d_0000..0x4040_0000).contains(&a);
            if is_flash {
                mem.map_flash(a, seg.flash_offset, seg.len);
            } else {
                let data = mem.flash.data[seg.flash_offset..seg.flash_offset + seg.len].to_vec();
                let mut bus = CoreBus { mem: &mut mem, periph: &mut periph, cpu: 0, apb: 0 };
                for (k, chunk) in data.chunks(4).enumerate() {
                    let mut w = [0u8; 4];
                    w[..chunk.len()].copy_from_slice(chunk);
                    bus.write(a + 4 * k as u32, 4, u32::from_le_bytes(w))
                        .map_err(|e| format!("cannot load segment at {a:#x}: {e:?}"))?;
                }
            }
        }

        let rom = Rom::new(&elf.symbols);
        let mut soc = Self {
            cpus: [Cpu::new(entry, 0xcdcd), Cpu::new(0, 0xabab)],
            running: [true, false],
            busy_until: [0; 2],
            mem,
            periph,
            rom,
            cycles: 0,
            pad_events: vec![],
            last_pads: [crate::periph::gpio::Gpio::default().pad(0); crate::periph::gpio::PADS],
            edge_prev: [0; 2],
            exceptions: vec![],
            stop_on_pad_change: false,
        };
        for k in 0..crate::periph::gpio::PADS {
            soc.last_pads[k] = soc.periph.gpio.pad(k);
        }
        soc.rom.init_data(&mut soc.mem, &mut soc.periph);
        // DevKit: BOOT button circuit pulls GPIO0 up through 10 kΩ
        soc.periph.gpio.board_pull_up = 1 << 0;
        // The bootloader calls the app entry with CALLX8 on its own stack (ROM stack area)
        soc.boot(0, entry, 0x3ffe_3f20);
        Ok(soc)
    }

    /// Start a core at `pc` as if called with CALLX8 from a function whose stack pointer is `sp`.
    fn boot(&mut self, core: usize, pc: u32, sp: u32) {
        // Spilling that caller frame (8 registers) reads its caller's SP from [sp − 12] and
        // stores a4..a7 32 bytes below it: point it at scratch space above `sp`
        let mut bus = CoreBus { mem: &mut self.mem, periph: &mut self.periph, cpu: core, apb: 0 };
        let _ = bus.write(sp - 12, 4, sp + 0x40);
        let cpu = &mut self.cpus[core];
        cpu.pc = pc;
        cpu.windowbase = 0;
        // The caller (bootloader) frame is live, like on real hardware: deep call chains spill
        // it, and spilling the entry function's frame relies on that.
        cpu.windowstart = 1;
        cpu.set_a(1, sp);
        cpu.ps = PS_WOE | (2 << PS_CALLINC_SHIFT);
        cpu.vecbase = 0x4000_0000;
        cpu.ccount = 0;
    }

    /// Drive a pad from outside (Some(level)) or release it (None).
    pub fn drive_pad(&mut self, gpio: usize, level: Option<bool>) {
        let g = &mut self.periph.gpio;
        match level {
            Some(l) => {
                g.external_mask |= 1 << gpio;
                if l { g.external_level |= 1 << gpio } else { g.external_level &= !(1 << gpio) }
            }
            None => g.external_mask &= !(1 << gpio),
        }
        g.input = g.resolve_input();
        g.dirty = true;
    }

    pub fn apb(&self) -> u64 {
        self.cycles / CPU_PER_APB
    }

    pub fn uart_output(&self, n: usize) -> &[u8] {
        &self.periph.uart[n].tx
    }

    /// Run until `until` CPU cycles have elapsed (or something stops the machine).
    pub fn run(&mut self, until: u64) -> Stop {
        while self.cycles < until {
            for core in 0..2 {
                if !self.running[core] {
                    continue;
                }
                if let Some(stop) = self.run_core(core) {
                    return stop;
                }
            }
            self.cycles += QUANTUM;
            let events = self.pad_events.len();
            self.sync();
            if self.stop_on_pad_change && self.pad_events.len() != events {
                return Stop::PadChange;
            }
            self.skip_idle(until);
        }
        Stop::Timeout
    }

    fn run_core(&mut self, core: usize) -> Option<Stop> {
        let mut used = 0;
        while used < QUANTUM {
            if self.cycles + used < self.busy_until[core] {
                let wait = (self.busy_until[core] - self.cycles - used).min(QUANTUM - used);
                self.cpus[core].tick(wait as u32);
                used += wait;
                continue;
            }
            let pc = self.cpus[core].pc;
            if (ROM_BASE..ROM_END).contains(&pc) && !self.cpus[core].waiting {
                match crate::rom::call(self, core) {
                    Ok(cost) => {
                        // The core stalls for the function's duration; CCOUNT advances meanwhile
                        self.busy_until[core] = self.busy_until[core].max(self.cycles + used + cost);
                        used += 1;
                        continue;
                    }
                    Err(stop) => return Some(stop),
                }
            }
            let apb = (self.cycles + used) / CPU_PER_APB;
            let mut bus = CoreBus { mem: &mut self.mem, periph: &mut self.periph, cpu: core, apb };
            match self.cpus[core].step(&mut bus) {
                Step::Ok => used += 1,
                Step::Waiting => {
                    self.cpus[core].tick((QUANTUM - used) as u32);
                    used = QUANTUM;
                }
                Step::Exception { cause, pc } => {
                    self.exceptions.push((self.cycles + used, core, cause, pc));
                    used += 1;
                }
                Step::Break { s, t } => return Some(Stop::Break { cpu: core, pc, s, t }),
            }
        }
        None
    }

    /// Peripherals, interrupt lines, APP_CPU release, pad change log.
    fn sync(&mut self) {
        let apb = self.apb();
        self.periph.update(apb);
        let sources: [bool; SOURCES] = self.periph.sources();
        for core in 0..2 {
            let lines = self.periph.cpu_lines(core, &sources);
            let cpu = &mut self.cpus[core];
            // Edge-triggered CPU interrupts latch on a rising line
            let edge = xtensa_core::cpu::INT_EDGE;
            let rising = lines & !self.edge_prev[core] & edge;
            cpu.interrupt |= rising;
            self.edge_prev[core] = lines;
            cpu.irq_lines = lines & !edge;
        }
        if !self.running[1] && self.periph.appcpu_released() {
            let addr = self.periph.appcpu_boot_addr.unwrap();
            let ccount = self.cpus[0].ccount;
            self.boot(1, addr, 0x3ffe_7e30);
            self.cpus[1].ccount = ccount;
            self.running[1] = true;
        }
        if !std::mem::take(&mut self.periph.gpio.dirty) {
            return;
        }
        self.periph.gpio.input = self.periph.gpio.resolve_input();
        for k in 0..crate::periph::gpio::PADS {
            let p = self.periph.gpio.pad(k);
            if p != self.last_pads[k] {
                self.last_pads[k] = p;
                self.pad_events.push(PadEvent { cycles: self.cycles, gpio: k, state: p });
            }
        }
    }

    /// When every running core sits in WAITI, jump straight to the next timer event.
    fn skip_idle(&mut self, until: u64) {
        let idle = (0..2).all(|c| {
            let cpu = &self.cpus[c];
            !self.running[c] || (cpu.waiting && !cpu.interrupt_ready() && self.busy_until[c] <= self.cycles)
        });
        if !idle {
            return;
        }
        let mut next = until.saturating_sub(self.cycles);
        for c in 0..2 {
            if self.running[c] {
                next = next.min(self.cpus[c].cycles_to_next_timer() as u64);
            }
        }
        if let Some(apb) = self.periph.apb_until_event(self.apb()) {
            next = next.min(apb * CPU_PER_APB);
        }
        // Leave the last quantum to the normal loop so the event is processed in order
        let skip = (next.saturating_sub(QUANTUM) / QUANTUM * QUANTUM).min(u32::MAX as u64 / 2);
        if skip == 0 {
            return;
        }
        for c in 0..2 {
            if self.running[c] {
                self.cpus[c].tick(skip as u32);
            }
        }
        self.cycles += skip;
        self.sync();
    }

}
