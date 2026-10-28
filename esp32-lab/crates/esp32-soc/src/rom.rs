//! High-level emulation of the ESP32 mask ROM.
//!
//! The ROM image is not shipped with firmware, so calls into 0x4000_0000–0x4006_FFFF are
//! intercepted: the firmware's own symbol table (it links against esp32.rom*.ld) names the
//! target, and the function is implemented here in Rust. A call is executed atomically, as if
//! the ROM function's ENTRY ... RETW ran: arguments are read from the callee's a2..a7 (the
//! caller's a(4n+2)..), the result goes into a2/a3 and the PC returns to the caller.
//!
//! Anything not implemented stops the machine with [`Stop::Rom`] naming the function, which is
//! the to-do list when bringing up new firmware.

use crate::mem::{Memory, ROM_BASE, ROM_END};
use crate::periph::Periph;
use crate::soc::{CoreBus, Soc, Stop, CPU_HZ, CPU_PER_APB};
use std::collections::HashMap;
use xtensa_core::cpu::{PS_CALLINC, PS_CALLINC_SHIFT, PS_INTLEVEL};
use xtensa_core::Bus;

pub struct Rom {
    /// ROM function address → every name the firmware knows it by (esp_rom_* aliases too).
    pub names: HashMap<u32, Vec<String>>,
    symbols: HashMap<String, u32>,
    /// Analog registers behind the internal I2C bus (rom_i2c_*): (block, reg) → value.
    i2c: HashMap<(u32, u32), u32>,
    pub calls: HashMap<String, u64>,
}

impl Rom {
    pub fn new(symbols: &HashMap<String, u32>) -> Self {
        let mut names: HashMap<u32, Vec<String>> = HashMap::new();
        for (name, &addr) in symbols {
            if (ROM_BASE..ROM_END).contains(&addr) {
                names.entry(addr).or_default().push(name.clone());
            }
        }
        for list in names.values_mut() {
            list.sort();
        }
        Self { names, symbols: symbols.clone(), i2c: HashMap::new(), calls: HashMap::new() }
    }

    /// ROM .data/.bss variables the firmware reads, as the ROM and bootloader leave them.
    pub fn init_data(&self, mem: &mut Memory, periph: &mut Periph) {
        let mut bus = CoreBus { mem, periph, cpu: 0, apb: 0 };
        if let Some(&chip) = self.symbols.get("g_rom_flashchip") {
            // esp_rom_spiflash_chip_t: device_id, chip_size, block, sector, page, status_mask
            let fields = [0x0016_40ef, crate::flash::FLASH_SIZE as u32, 0x1_0000, 0x1000, 0x100, 0xffff];
            for (k, v) in fields.iter().enumerate() {
                let _ = bus.write(chip + 4 * k as u32, 4, *v);
            }
        }
        for name in ["g_ticks_per_us_pro", "g_ticks_per_us_app"] {
            if let Some(&a) = self.symbols.get(name) {
                let _ = bus.write(a, 4, (CPU_HZ / 1_000_000) as u32);
            }
        }
    }
}

/// Argument/return access for one intercepted call.
struct Call<'a> {
    soc: &'a mut Soc,
    core: usize,
    base: u8,
}

impl Call<'_> {
    fn bus(&mut self) -> CoreBus<'_> {
        let apb = self.soc.cycles / CPU_PER_APB;
        CoreBus { mem: &mut self.soc.mem, periph: &mut self.soc.periph, cpu: self.core, apb }
    }

    /// Argument word `i`: a2..a7 of the callee, then the caller's outgoing-argument area.
    fn arg(&mut self, i: usize) -> u32 {
        if i < 6 {
            self.soc.cpus[self.core].a(self.base + i as u8)
        } else {
            let sp = self.soc.cpus[self.core].a(1);
            self.r32(sp + 4 * (i as u32 - 6))
        }
    }

    /// 64-bit argument occupying words `i`, `i+1` (low word first).
    fn arg64(&mut self, i: usize) -> u64 {
        self.arg(i) as u64 | ((self.arg(i + 1) as u64) << 32)
    }

    fn f64_arg(&mut self, i: usize) -> f64 {
        f64::from_bits(self.arg64(i))
    }

    fn f32_arg(&mut self, i: usize) -> f32 {
        f32::from_bits(self.arg(i))
    }

    fn ret(&mut self, v: u32) {
        let b = self.base;
        self.soc.cpus[self.core].set_a(b, v);
    }

    fn ret64(&mut self, v: u64) {
        let b = self.base;
        self.soc.cpus[self.core].set_a(b, v as u32);
        self.soc.cpus[self.core].set_a(b + 1, (v >> 32) as u32);
    }

    fn r32(&mut self, a: u32) -> u32 {
        // Word reads also work on IRAM/flash where byte reads would fault
        let w = self.bus().read(a & !3, 4).unwrap_or(0);
        if a & 3 == 0 {
            return w;
        }
        let hi = self.bus().read((a & !3) + 4, 4).unwrap_or(0);
        let shift = (a & 3) * 8;
        (w >> shift) | (hi << (32 - shift))
    }

    fn byte(&mut self, a: u32) -> u8 {
        (self.r32(a & !3) >> (8 * (a & 3))) as u8
    }

    fn w8(&mut self, a: u32, v: u8) {
        if self.bus().write(a, 1, v as u32).is_err() {
            // IRAM: read-modify-write the containing word
            let shift = 8 * (a & 3);
            let w = self.r32(a & !3) & !(0xff << shift) | ((v as u32) << shift);
            let _ = self.bus().write(a & !3, 4, w);
        }
    }

    fn w32(&mut self, a: u32, v: u32) {
        let _ = self.bus().write(a, 4, v);
    }

    fn read_bytes(&mut self, a: u32, len: u32) -> Vec<u8> {
        (0..len).map(|k| self.byte(a + k)).collect()
    }

    fn write_bytes(&mut self, a: u32, data: &[u8]) {
        for (k, &b) in data.iter().enumerate() {
            self.w8(a + k as u32, b);
        }
    }

    fn cstr(&mut self, a: u32) -> Vec<u8> {
        let mut out = vec![];
        for k in 0..4096 {
            let b = self.byte(a + k);
            if b == 0 {
                break;
            }
            out.push(b);
        }
        out
    }
}

/// printf-style formatting over guest memory and a word-based va_list.
fn format(c: &mut Call, fmt: &[u8], mut next: impl FnMut(&mut Call, bool) -> u64) -> Vec<u8> {
    let mut out = vec![];
    let mut i = 0;
    while i < fmt.len() {
        let ch = fmt[i];
        i += 1;
        if ch != b'%' {
            out.push(ch);
            continue;
        }
        let (mut left, mut zero, mut plus, mut space, mut alt) = (false, false, false, false, false);
        while i < fmt.len() {
            match fmt[i] {
                b'-' => left = true,
                b'0' => zero = true,
                b'+' => plus = true,
                b' ' => space = true,
                b'#' => alt = true,
                _ => break,
            }
            i += 1;
        }
        let mut width = 0usize;
        if i < fmt.len() && fmt[i] == b'*' {
            width = next(c, false) as usize;
            i += 1;
        }
        while i < fmt.len() && fmt[i].is_ascii_digit() {
            width = width * 10 + (fmt[i] - b'0') as usize;
            i += 1;
        }
        let mut precision: Option<usize> = None;
        if i < fmt.len() && fmt[i] == b'.' {
            i += 1;
            let mut p = 0;
            if i < fmt.len() && fmt[i] == b'*' {
                p = next(c, false) as usize;
                i += 1;
            }
            while i < fmt.len() && fmt[i].is_ascii_digit() {
                p = p * 10 + (fmt[i] - b'0') as usize;
                i += 1;
            }
            precision = Some(p);
        }
        let mut long_long = false;
        while i < fmt.len() && matches!(fmt[i], b'l' | b'h' | b'z' | b'j' | b't') {
            if fmt[i] == b'l' && i + 1 < fmt.len() && fmt[i + 1] == b'l' {
                long_long = true;
                i += 1;
            }
            i += 1;
        }
        let Some(&conv) = fmt.get(i) else { break };
        i += 1;
        let mut sign = String::new();
        let body: String = match conv {
            b'd' | b'i' => {
                let v = next(c, long_long);
                let v = if long_long { v as i64 } else { v as u32 as i32 as i64 };
                if v < 0 {
                    sign.push('-');
                } else if plus {
                    sign.push('+');
                } else if space {
                    sign.push(' ');
                }
                v.unsigned_abs().to_string()
            }
            b'u' => next(c, long_long).to_string(),
            b'x' | b'X' | b'o' | b'p' => {
                let v = next(c, long_long && conv != b'p');
                let s = match conv {
                    b'o' => format!("{v:o}"),
                    b'X' => format!("{v:X}"),
                    _ => format!("{v:x}"),
                };
                if conv == b'p' || (alt && v != 0 && conv != b'o') {
                    sign.push_str(if conv == b'X' { "0X" } else { "0x" });
                }
                s
            }
            b'c' => (next(c, false) as u8 as char).to_string(),
            b's' => {
                let p = next(c, false) as u32;
                let mut s = if p == 0 { b"(null)".to_vec() } else { c.cstr(p) };
                if let Some(n) = precision {
                    s.truncate(n);
                }
                String::from_utf8_lossy(&s).into_owned()
            }
            b'%' => "%".into(),
            _ => "?".into(),
        };
        let body = match (conv, precision) {
            (b'd' | b'i' | b'u' | b'x' | b'X', Some(p)) if body.len() < p => format!("{}{body}", "0".repeat(p - body.len())),
            _ => body,
        };
        let len = sign.len() + body.len();
        let pad = width.saturating_sub(len);
        if left {
            out.extend(sign.bytes().chain(body.bytes()));
            out.extend(std::iter::repeat(b' ').take(pad));
        } else if zero && conv != b's' && conv != b'c' {
            out.extend(sign.bytes());
            out.extend(std::iter::repeat(b'0').take(pad));
            out.extend(body.bytes());
        } else {
            out.extend(std::iter::repeat(b' ').take(pad));
            out.extend(sign.bytes().chain(body.bytes()));
        }
    }
    out
}

/// Variadic arguments starting at argument word `first`.
fn varargs(first: usize) -> impl FnMut(&mut Call, bool) -> u64 {
    let mut word = first;
    move |c: &mut Call, wide: bool| {
        if wide {
            word = (word + 1) & !1; // 64-bit values start on an even register/word
            let v = c.arg64(word);
            word += 2;
            v
        } else {
            let v = c.arg(word) as u64;
            word += 1;
            v
        }
    }
}

fn crc32_le(crc: u32, data: &[u8]) -> u32 {
    let mut c = !crc;
    for &b in data {
        c ^= b as u32;
        for _ in 0..8 {
            c = (c >> 1) ^ (0xedb8_8320 & (c & 1).wrapping_neg());
        }
    }
    !c
}

/// Execute the ROM function at the current PC. Returns the cycles it took.
pub fn call(soc: &mut Soc, core: usize) -> Result<u64, Stop> {
    let pc = soc.cpus[core].pc;
    let Some(names) = soc.rom.names.get(&pc).cloned() else {
        return Err(Stop::Rom(format!("jump into ROM at {pc:#010x} (no symbol)")));
    };
    for name in &names {
        if let Some(result) = call_named(soc, core, pc, name) {
            *soc.rom.calls.entry(name.clone()).or_default() += 1;
            return result;
        }
    }
    Err(Stop::Rom(format!("ROM function `{}` at {pc:#010x} is not emulated", names.join("` / `"))))
}

/// Run one ROM function by name; None if this name is not implemented.
fn call_named(soc: &mut Soc, core: usize, pc: u32, name: &str) -> Option<Result<u64, Stop>> {
    let callinc = (soc.cpus[core].ps & PS_CALLINC) >> PS_CALLINC_SHIFT;
    let base = (callinc * 4 + 2) as u8;
    // ROM newlib syscalls (open, read, write...) just forward to the firmware's reentrant
    // versions with the global reent pointer prepended: emulate that as a tail call.
    const REENT_SYSCALLS: [(&str, &str, u8); 9] = [
        ("open", "_open_r", 3),
        ("close", "_close_r", 1),
        ("read", "_read_r", 3),
        ("write", "_write_r", 3),
        ("lseek", "_lseek_r", 3),
        ("fstat", "_fstat_r", 2),
        ("unlink", "_unlink_r", 1),
        ("rename", "_rename_r", 2),
        ("link", "_link_r", 2),
    ];
    if let Some(&(_, target_name, argc)) = REENT_SYSCALLS.iter().find(|(n, _, _)| *n == name) {
        let target = *soc.rom.symbols.get(target_name)?;
        let reent_ptr = *soc.rom.symbols.get("_global_impure_ptr")?;
        let mut c = Call { soc, core, base };
        let reent = c.r32(reent_ptr);
        let cpu = &mut c.soc.cpus[core];
        for k in (0..argc).rev() {
            let v = cpu.a(base + k);
            cpu.set_a(base + k + 1, v);
        }
        cpu.set_a(base, reent);
        cpu.pc = target;
        return Some(Ok(5));
    }

    let mut c = Call { soc, core, base };
    let mut cost: u64 = 20;

    let cmp = |a: f64, b: f64, nan: i32| -> u32 {
        if a.is_nan() || b.is_nan() {
            nan as u32
        } else if a < b {
            -1i32 as u32
        } else if a > b {
            1
        } else {
            0
        }
    };

    match name {
        // --- Console --------------------------------------------------------------------
        "ets_printf" | "esp_rom_printf" => {
            let fmt_ptr = c.arg(0);
            let fmt = c.cstr(fmt_ptr);
            let text = format(&mut c, &fmt, varargs(1));
            cost += text.len() as u64 * 10;
            c.ret(text.len() as u32);
            c.soc.periph.uart[0].tx.extend(text);
        }
        "uart_tx_one_char" | "esp_rom_output_tx_one_char" | "ets_write_char_uart" => {
            let ch = c.arg(0) as u8;
            c.soc.periph.uart[0].tx.push(ch);
            c.ret(0);
        }
        "uart_rx_one_char" => c.ret(1), // FAIL: nothing received
        "ets_install_putc1" | "ets_install_putc2" | "ets_install_uart_printf" | "uart_tx_switch"
        | "uart_tx_wait_idle" | "uart_tx_flush" | "uart_div_modify" | "uart_buff_switch" => c.ret(0),

        // --- Timing and CPU -------------------------------------------------------------
        "ets_delay_us" | "esp_rom_delay_us" => {
            let us = c.arg(0) as u64;
            cost = us * (CPU_HZ / 1_000_000);
        }
        // The ROM keeps CPU ticks per µs in g_ticks_per_us_{pro,app}; IDF updates it on every
        // clock switch and reads it back to decide how to reconfigure timers
        "ets_get_cpu_frequency" | "esp_rom_get_cpu_ticks_per_us" => {
            let var = if core == 0 { "g_ticks_per_us_pro" } else { "g_ticks_per_us_app" };
            let v = match c.soc.rom.symbols.get(var).copied() {
                Some(a) => c.r32(a),
                None => (CPU_HZ / 1_000_000) as u32,
            };
            c.ret(v);
        }
        "ets_update_cpu_frequency" | "ets_update_cpu_frequency_rom" => {
            let ticks = c.arg(0);
            let var = if core == 0 { "g_ticks_per_us_pro" } else { "g_ticks_per_us_app" };
            if let Some(a) = c.soc.rom.symbols.get(var).copied() {
                c.w32(a, ticks);
            }
        }
        "rtc_get_reset_reason" | "esp_rom_get_reset_reason" => c.ret(1), // POWERON_RESET
        "ets_set_appcpu_boot_addr" => {
            let a = c.arg(0);
            c.soc.periph.appcpu_boot_addr = if a == 0 { None } else { Some(a) };
        }
        "_xtos_set_intlevel" => {
            let level = c.arg(0) & PS_INTLEVEL;
            let ps = c.soc.cpus[core].ps;
            c.soc.cpus[core].ps = (ps & !PS_INTLEVEL) | level;
            c.ret(ps);
        }
        "software_reset" | "software_reset_cpu" => return Some(Err(Stop::Reset(name.to_string()))),

        // --- Cache, flash and MMU (the static mapping is set up at boot) ----------------
        "Cache_Read_Enable_rom" | "Cache_Read_Disable_rom" | "Cache_Flush_rom" | "Cache_Read_Enable"
        | "Cache_Read_Disable" | "Cache_Flush" | "mmu_init" | "esp_rom_spiflash_config_clk"
        | "esp_rom_spiflash_attach" | "esp_rom_spiflash_config_param" => c.ret(0),
        "ets_efuse_get_spiconfig" => c.ret(0),

        // --- GPIO matrix / interrupt matrix ---------------------------------------------
        "gpio_matrix_in" => {
            let (gpio, signal, inv) = (c.arg(0), c.arg(1), c.arg(2));
            // GPIO_FUNCn_IN_SEL_CFG: IN_SEL [5:0], IN_INV [6], SEL [7]
            c.w32(0x3ff4_4130 + 4 * signal, (gpio & 0x3f) | ((inv & 1) << 6) | (1 << 7));
        }
        "gpio_matrix_out" => {
            let (gpio, signal, out_inv, oen_inv) = (c.arg(0), c.arg(1), c.arg(2), c.arg(3));
            c.w32(0x3ff4_4530 + 4 * gpio, (signal & 0x1ff) | ((out_inv & 1) << 9) | ((oen_inv & 1) << 11));
        }
        "gpio_pad_select_gpio" => {
            let gpio = c.arg(0) as usize;
            if let Some(&off) = crate::periph::gpio::IO_MUX_OFFSET.get(gpio) {
                if off != 0 {
                    let a = crate::periph::IO_MUX + off;
                    let v = c.r32(a);
                    c.w32(a, (v & !(7 << 12)) | (2 << 12)); // MCU_SEL = 2: GPIO
                }
            }
        }
        "gpio_pad_pullup" | "gpio_pad_pulldown" | "gpio_pad_unhold" | "gpio_pad_hold" => {}
        "intr_matrix_set" => {
            let (cpu, source, intr) = (c.arg(0) as usize, c.arg(1) as usize, c.arg(2));
            if cpu < 2 && source < crate::periph::SOURCES {
                c.soc.periph.intr_map[cpu][source] = intr as u8;
            }
        }

        // --- Analog I2C bus ---------------------------------------------------------------
        "rom_i2c_writeReg" | "esp_rom_regi2c_write" => {
            let (block, reg, data) = (c.arg(0), c.arg(2), c.arg(3));
            c.soc.rom.i2c.insert((block, reg), data & 0xff);
        }
        "rom_i2c_readReg" | "esp_rom_regi2c_read" => {
            let (block, reg) = (c.arg(0), c.arg(2));
            let v = c.soc.rom.i2c.get(&(block, reg)).copied().unwrap_or(0);
            c.ret(v);
        }
        "rom_i2c_writeReg_Mask" | "esp_rom_regi2c_write_mask" => {
            let (block, reg, msb, lsb, data) = (c.arg(0), c.arg(2), c.arg(3), c.arg(4), c.arg(5));
            let mask = ((1u32 << (msb - lsb + 1)) - 1) << lsb;
            let old = c.soc.rom.i2c.get(&(block, reg)).copied().unwrap_or(0);
            c.soc.rom.i2c.insert((block, reg), (old & !mask) | ((data << lsb) & mask));
        }
        "rom_i2c_readReg_Mask" | "esp_rom_regi2c_read_mask" => {
            let (block, reg, msb, lsb) = (c.arg(0), c.arg(2), c.arg(3), c.arg(4));
            let v = c.soc.rom.i2c.get(&(block, reg)).copied().unwrap_or(0);
            c.ret((v >> lsb) & ((1 << (msb - lsb + 1)) - 1));
        }

        // --- Checksums --------------------------------------------------------------------
        "crc32_le" | "esp_rom_crc32_le" => {
            let (crc, buf, len) = (c.arg(0), c.arg(1), c.arg(2));
            let data = c.read_bytes(buf, len);
            c.ret(crc32_le(crc, &data));
        }
        "esp_crc8" | "esp_rom_efuse_mac_address_crc8" => {
            let (buf, len) = (c.arg(0), c.arg(1));
            let data = c.read_bytes(buf, len);
            c.ret(crate::periph::crc8_maxim(&data) as u32);
        }

        "MD5Init" | "esp_rom_md5_init" => {
            let ctx = c.arg(0);
            let bytes = crate::md5::Context::new().to_bytes();
            c.write_bytes(ctx, &bytes);
        }
        "MD5Update" | "esp_rom_md5_update" => {
            let (ctx, data, len) = (c.arg(0), c.arg(1), c.arg(2));
            let raw = c.read_bytes(ctx, crate::md5::CONTEXT_SIZE as u32);
            let mut m = crate::md5::Context::from_bytes(&raw);
            let input = c.read_bytes(data, len);
            m.update(&input);
            let bytes = m.to_bytes();
            c.write_bytes(ctx, &bytes);
            cost += len as u64 * 2;
        }
        "MD5Final" | "esp_rom_md5_final" => {
            let (digest, ctx) = (c.arg(0), c.arg(1));
            let raw = c.read_bytes(ctx, crate::md5::CONTEXT_SIZE as u32);
            let out = crate::md5::Context::from_bytes(&raw).finish();
            c.write_bytes(digest, &out);
        }

        // --- libc string/memory functions -------------------------------------------------
        "memcpy" | "memmove" => {
            let (d, s, n) = (c.arg(0), c.arg(1), c.arg(2));
            let data = c.read_bytes(s, n);
            c.write_bytes(d, &data);
            cost += n as u64 / 4;
            c.ret(d);
        }
        "memset" => {
            let (d, v, n) = (c.arg(0), c.arg(1) as u8, c.arg(2));
            if d & 3 == 0 && n % 4 == 0 {
                let w = u32::from_le_bytes([v; 4]);
                for k in (0..n).step_by(4) {
                    c.w32(d + k, w);
                }
            } else {
                for k in 0..n {
                    c.w8(d + k, v);
                }
            }
            cost += n as u64 / 4;
            c.ret(d);
        }
        "memcmp" => {
            let (a, b, n) = (c.arg(0), c.arg(1), c.arg(2));
            let (x, y) = (c.read_bytes(a, n), c.read_bytes(b, n));
            let r = x.iter().zip(&y).find(|(p, q)| p != q).map_or(0, |(p, q)| *p as i32 - *q as i32);
            c.ret(r as u32);
        }
        "strlen" => {
            let s = c.arg(0);
            let n = c.cstr(s).len();
            c.ret(n as u32);
        }
        "strnlen" => {
            let (s, max) = (c.arg(0), c.arg(1) as usize);
            let n = c.cstr(s).len().min(max);
            c.ret(n as u32);
        }
        "strcmp" | "strncmp" => {
            let (a, b) = (c.arg(0), c.arg(1));
            let limit = if name == "strncmp" { c.arg(2) as usize } else { usize::MAX };
            let (mut x, mut y) = (c.cstr(a), c.cstr(b));
            x.truncate(limit);
            y.truncate(limit);
            x.push(0);
            y.push(0);
            let r = x.iter().zip(&y).find(|(p, q)| p != q).map_or(0, |(p, q)| *p as i32 - *q as i32);
            c.ret(r as u32);
        }
        "strcpy" | "strncpy" => {
            let (d, s) = (c.arg(0), c.arg(1));
            let mut data = c.cstr(s);
            if name == "strncpy" {
                let n = c.arg(2) as usize;
                data.resize(n, 0);
            } else {
                data.push(0);
            }
            c.write_bytes(d, &data);
            c.ret(d);
        }
        "strchr" | "strrchr" => {
            let (s, ch) = (c.arg(0), c.arg(1) as u8);
            let mut data = c.cstr(s);
            data.push(0);
            let pos = if name == "strchr" { data.iter().position(|&b| b == ch) } else { data.iter().rposition(|&b| b == ch) };
            c.ret(pos.map_or(0, |p| s + p as u32));
        }

        // --- libgcc: 64-bit integers ------------------------------------------------------
        "__ashldi3" => {
            let (v, n) = (c.arg64(0), c.arg(2));
            c.ret64(v.wrapping_shl(n));
        }
        "__lshrdi3" => {
            let (v, n) = (c.arg64(0), c.arg(2));
            c.ret64(v.wrapping_shr(n));
        }
        "__ashrdi3" => {
            let (v, n) = (c.arg64(0) as i64, c.arg(2));
            c.ret64(v.wrapping_shr(n) as u64);
        }
        "__muldi3" => {
            let (a, b) = (c.arg64(0), c.arg64(2));
            c.ret64(a.wrapping_mul(b));
        }
        "__udivdi3" | "__umoddi3" | "__divdi3" | "__moddi3" => {
            let (a, b) = (c.arg64(0), c.arg64(2));
            if b == 0 {
                c.ret64(0);
            } else {
                let v = match name {
                    "__udivdi3" => a / b,
                    "__umoddi3" => a % b,
                    "__divdi3" => (a as i64).wrapping_div(b as i64) as u64,
                    _ => (a as i64).wrapping_rem(b as i64) as u64,
                };
                c.ret64(v);
            }
            cost += 60;
        }
        "__negdi2" => {
            let v = c.arg64(0);
            c.ret64(v.wrapping_neg());
        }
        "__cmpdi2" | "__ucmpdi2" => {
            let (a, b) = (c.arg64(0), c.arg64(2));
            let o = if name == "__cmpdi2" { (a as i64).cmp(&(b as i64)) } else { a.cmp(&b) };
            c.ret(o as i32 as u32 + 1);
        }
        "__bswapsi2" => {
            let v = c.arg(0);
            c.ret(v.swap_bytes());
        }
        "__bswapdi2" => {
            let v = c.arg64(0);
            c.ret64(v.swap_bytes());
        }
        "__popcountsi2" => {
            let v = c.arg(0);
            c.ret(v.count_ones());
        }
        "__popcountdi2" => {
            let v = c.arg64(0);
            c.ret(v.count_ones());
        }
        "__clzsi2" => {
            let v = c.arg(0);
            c.ret(v.leading_zeros());
        }
        "__ctzsi2" => {
            let v = c.arg(0);
            c.ret(v.trailing_zeros());
        }
        "__clzdi2" => {
            let v = c.arg64(0);
            c.ret(v.leading_zeros());
        }
        "__ctzdi2" => {
            let v = c.arg64(0);
            c.ret(v.trailing_zeros());
        }
        "__ffssi2" => {
            let v = c.arg(0);
            c.ret(if v == 0 { 0 } else { v.trailing_zeros() + 1 });
        }

        // --- libgcc: soft-float double (and the float helpers the FPU lacks) --------------
        "__adddf3" | "__subdf3" | "__muldf3" | "__divdf3" => {
            let (a, b) = (c.f64_arg(0), c.f64_arg(2));
            let v = match name {
                "__adddf3" => a + b,
                "__subdf3" => a - b,
                "__muldf3" => a * b,
                _ => a / b,
            };
            c.ret64(v.to_bits());
            cost += 80;
        }
        "__negdf2" => {
            let v = c.arg64(0);
            c.ret64(v ^ (1 << 63));
        }
        "__eqdf2" | "__nedf2" => {
            let (a, b) = (c.f64_arg(0), c.f64_arg(2));
            c.ret(cmp(a, b, 1));
        }
        "__ltdf2" | "__ledf2" => {
            let (a, b) = (c.f64_arg(0), c.f64_arg(2));
            c.ret(cmp(a, b, 1));
        }
        "__gtdf2" | "__gedf2" => {
            let (a, b) = (c.f64_arg(0), c.f64_arg(2));
            c.ret(cmp(a, b, -1));
        }
        "__unorddf2" => {
            let (a, b) = (c.f64_arg(0), c.f64_arg(2));
            c.ret((a.is_nan() || b.is_nan()) as u32);
        }
        "__fixdfsi" => {
            let v = c.f64_arg(0);
            c.ret(v as i32 as u32);
        }
        "__fixunsdfsi" => {
            let v = c.f64_arg(0);
            c.ret(v as u32);
        }
        "__fixdfdi" => {
            let v = c.f64_arg(0);
            c.ret64(v as i64 as u64);
        }
        "__fixunsdfdi" => {
            let v = c.f64_arg(0);
            c.ret64(v as u64);
        }
        "__floatsidf" => {
            let v = c.arg(0) as i32;
            c.ret64((v as f64).to_bits());
        }
        "__floatunsidf" => {
            let v = c.arg(0);
            c.ret64((v as f64).to_bits());
        }
        "__floatdidf" => {
            let v = c.arg64(0) as i64;
            c.ret64((v as f64).to_bits());
        }
        "__floatundidf" => {
            let v = c.arg64(0);
            c.ret64((v as f64).to_bits());
        }
        "__extendsfdf2" => {
            let v = c.f32_arg(0);
            c.ret64((v as f64).to_bits());
        }
        "__truncdfsf2" => {
            let v = c.f64_arg(0);
            c.ret((v as f32).to_bits());
        }
        "__divsf3" => {
            let (a, b) = (c.f32_arg(0), c.f32_arg(1));
            c.ret((a / b).to_bits());
        }
        "__fixsfdi" => {
            let v = c.f32_arg(0);
            c.ret64(v as i64 as u64);
        }
        "__fixunssfdi" => {
            let v = c.f32_arg(0);
            c.ret64(v as u64);
        }
        "__floatdisf" => {
            let v = c.arg64(0) as i64;
            c.ret((v as f32).to_bits());
        }
        "__floatundisf" => {
            let v = c.arg64(0);
            c.ret((v as f32).to_bits());
        }

        _ => return None,
    }

    // Return to the caller as RETW (or RET for CALL0) would
    let cpu = &mut c.soc.cpus[core];
    cpu.pc = if callinc == 0 { cpu.a(0) } else { (pc & 0xc000_0000) | (cpu.a((callinc * 4) as u8) & 0x3fff_ffff) };
    cpu.retired += 1;
    Some(Ok(cost))
}
