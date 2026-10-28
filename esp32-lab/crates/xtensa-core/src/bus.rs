//! The CPU's view of memory. The SoC crate implements this with the ESP32 memory map and
//! peripherals; tests use [`FlatMemory`].

/// Why an access failed. The CPU turns this into the matching Xtensa exception.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BusError {
    /// Nothing mapped at this address (→ LoadStorePIFAddrError / InstrPIFAddrError).
    Unmapped,
    /// Mapped, but this access width is not allowed (e.g. byte access to IRAM → LoadStoreError).
    BadWidth,
}

pub trait Bus {
    /// Read 1, 2 or 4 bytes, little-endian. `addr` is aligned to `size` (the CPU checks).
    fn read(&mut self, addr: u32, size: u8) -> Result<u32, BusError>;
    fn write(&mut self, addr: u32, size: u8, value: u32) -> Result<(), BusError>;

    /// Bumped whenever memory that may hold code changes (IRAM writes, MMU remaps, flash
    /// programming). The CPU drops its decoded-instruction cache when it changes.
    fn code_generation(&self) -> u64 {
        0
    }

    /// Instruction fetch: the 4 bytes starting at `addr` (any alignment), little-endian.
    /// Bytes past the end of a region may be garbage as long as the first 3 are right.
    fn fetch(&mut self, addr: u32) -> Result<u32, BusError> {
        let lo = self.read(addr & !3, 4)?;
        let shift = (addr & 3) * 8;
        if shift == 0 {
            return Ok(lo);
        }
        let hi = self.read((addr & !3).wrapping_add(4), 4).unwrap_or(0);
        Ok((lo >> shift) | (hi << (32 - shift)))
    }
}

/// A single RAM region, for tests and bare-metal experiments.
pub struct FlatMemory {
    pub base: u32,
    pub data: Vec<u8>,
}

impl FlatMemory {
    pub fn new(base: u32, size: usize) -> Self {
        Self { base, data: vec![0; size] }
    }

    pub fn load(&mut self, addr: u32, bytes: &[u8]) {
        let off = (addr - self.base) as usize;
        self.data[off..off + bytes.len()].copy_from_slice(bytes);
    }

    fn offset(&self, addr: u32, size: u8) -> Result<usize, BusError> {
        let off = addr.wrapping_sub(self.base) as usize;
        if off + size as usize <= self.data.len() { Ok(off) } else { Err(BusError::Unmapped) }
    }
}

impl Bus for FlatMemory {
    fn read(&mut self, addr: u32, size: u8) -> Result<u32, BusError> {
        let off = self.offset(addr, size)?;
        let mut v = 0u32;
        for k in 0..size as usize {
            v |= (self.data[off + k] as u32) << (8 * k);
        }
        Ok(v)
    }

    fn write(&mut self, addr: u32, size: u8, value: u32) -> Result<(), BusError> {
        let off = self.offset(addr, size)?;
        for k in 0..size as usize {
            self.data[off + k] = (value >> (8 * k)) as u8;
        }
        Ok(())
    }
}
