//! SPI flash contents and the ESP-IDF app image format.
//!
//! The flash image is assembled the way `esptool write_flash` lays it out for PlatformIO:
//! bootloader at 0x1000, partition table at 0x8000, app at 0x10000. Unwritten flash reads 0xFF.

pub const FLASH_SIZE: usize = 4 * 1024 * 1024;
pub const BOOTLOADER_OFFSET: usize = 0x1000;
pub const PARTITIONS_OFFSET: usize = 0x8000;
pub const APP_OFFSET: usize = 0x10000;

pub struct Flash {
    pub data: Vec<u8>,
}

impl Flash {
    pub fn blank() -> Self {
        Self { data: vec![0xff; FLASH_SIZE] }
    }

    pub fn write(&mut self, offset: usize, bytes: &[u8]) {
        self.data[offset..offset + bytes.len()].copy_from_slice(bytes);
    }

    /// NOR flash programming can only clear bits.
    pub fn program(&mut self, offset: usize, bytes: &[u8]) {
        for (k, b) in bytes.iter().enumerate() {
            if let Some(cell) = self.data.get_mut(offset + k) {
                *cell &= b;
            }
        }
    }

    pub fn erase(&mut self, offset: usize, len: usize) {
        let end = (offset + len).min(self.data.len());
        self.data[offset.min(end)..end].fill(0xff);
    }
}

#[derive(Debug, Clone)]
pub struct ImageSegment {
    pub load_addr: u32,
    /// Offset of the segment data inside the flash.
    pub flash_offset: usize,
    pub len: usize,
}

/// Parse an ESP-IDF app image (esp_image_header_t + segments) located at `offset` in flash.
pub fn parse_app_image(flash: &Flash, offset: usize) -> Result<(u32, Vec<ImageSegment>), String> {
    let d = &flash.data;
    if d[offset] != 0xe9 {
        return Err(format!("no app image at 0x{offset:x} (magic {:#04x})", d[offset]));
    }
    let count = d[offset + 1] as usize;
    let entry = u32::from_le_bytes(d[offset + 4..offset + 8].try_into().unwrap());
    let mut p = offset + 24;
    let mut segments = vec![];
    for _ in 0..count {
        let load_addr = u32::from_le_bytes(d[p..p + 4].try_into().unwrap());
        let len = u32::from_le_bytes(d[p + 4..p + 8].try_into().unwrap()) as usize;
        segments.push(ImageSegment { load_addr, flash_offset: p + 8, len });
        p += 8 + len;
    }
    Ok((entry, segments))
}
