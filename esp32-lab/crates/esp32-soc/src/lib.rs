//! ESP32 system-on-chip around two `xtensa-core` CPUs.

pub mod elf;
pub mod flash;
pub mod md5;
pub mod mem;
pub mod periph;
pub mod rom;
pub mod soc;

pub use soc::{PadEvent, Soc, Stop, CPU_HZ};
