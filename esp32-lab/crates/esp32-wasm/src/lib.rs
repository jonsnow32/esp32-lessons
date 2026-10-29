//! WebAssembly interface to the ESP32 emulator.
//!
//! Plain `extern "C"` exports, no wasm-bindgen: the JS side (packages/mcu-esp32/src/wasm.ts)
//! copies firmware into memory obtained from `alloc`, creates a SoC, then alternates
//! `run_until` with reading pad states and writing pad input levels.
//!
//! Times are in CPU cycles (240 MHz) passed as f64, which is exact up to 2^53 cycles (≈ 433 days).

use esp32_soc::periph::i2c::{Op, Reply};
use esp32_soc::{Soc, Stop};

static mut SCRATCH: Vec<u8> = Vec::new();

fn scratch(data: Vec<u8>) -> u32 {
    // SAFETY: wasm is single-threaded; the JS side copies the buffer before the next call
    unsafe {
        let s = &mut *std::ptr::addr_of_mut!(SCRATCH);
        *s = data;
        s.len() as u32
    }
}

/// Pointer to the bytes returned by the last call that reported a length.
#[no_mangle]
pub extern "C" fn scratch_ptr() -> *const u8 {
    unsafe { (*std::ptr::addr_of!(SCRATCH)).as_ptr() }
}

#[no_mangle]
pub extern "C" fn alloc(len: u32) -> *mut u8 {
    let mut v = vec![0u8; len as usize];
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: *mut u8, len: u32) {
    unsafe { drop(Vec::from_raw_parts(ptr, len as usize, len as usize)) }
}

unsafe fn slice<'a>(ptr: *const u8, len: u32) -> Option<&'a [u8]> {
    (len > 0).then(|| std::slice::from_raw_parts(ptr, len as usize))
}

/// Boot a PlatformIO build. Returns null on failure (message via `last_error`).
#[no_mangle]
pub unsafe extern "C" fn soc_new(
    elf: *const u8,
    elf_len: u32,
    bin: *const u8,
    bin_len: u32,
    boot: *const u8,
    boot_len: u32,
    parts: *const u8,
    parts_len: u32,
) -> *mut Soc {
    let result = Soc::from_build(
        slice(elf, elf_len).unwrap_or(&[]),
        slice(bin, bin_len).unwrap_or(&[]),
        slice(boot, boot_len),
        slice(parts, parts_len),
    );
    match result {
        Ok(mut soc) => {
            soc.stop_on_pad_change = true;
            soc.i2c_host = true;
            Box::into_raw(Box::new(soc))
        }
        Err(e) => {
            scratch(e.into_bytes());
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn soc_free(soc: *mut Soc) {
    drop(Box::from_raw(soc));
}

/// Length of the last error / stop message (bytes at `scratch_ptr`).
#[no_mangle]
pub extern "C" fn last_error_len() -> u32 {
    unsafe { (*std::ptr::addr_of!(SCRATCH)).len() as u32 }
}

/// Run until `until` cycles or a pad change. 0 = reached, 1 = pad changed, 2 = stopped
/// (message via scratch: BREAK, unimplemented ROM function, reset), 3 = an I2C transaction
/// waits for the bus (`soc_i2c_take`, then `soc_i2c_answer`).
#[no_mangle]
pub unsafe extern "C" fn soc_run_until(soc: *mut Soc, until: f64) -> u32 {
    match (*soc).run(until as u64) {
        Stop::Timeout => 0,
        Stop::PadChange => 1,
        Stop::I2c => 3,
        other => {
            scratch(format!("{other:?}").into_bytes());
            2
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn soc_cycles(soc: *const Soc) -> f64 {
    (*soc).cycles as f64
}

/// Bytes UART `port` transmitted since the last call (at `scratch_ptr`).
#[no_mangle]
pub unsafe extern "C" fn soc_uart_take(soc: *mut Soc, port: u32) -> u32 {
    let tx = std::mem::take(&mut (*soc).periph.uart[port as usize % 3].tx);
    scratch(tx)
}

#[no_mangle]
pub unsafe extern "C" fn soc_uart_push(soc: *mut Soc, port: u32, byte: u32) {
    (*soc).periph.uart[port as usize % 3].rx.push_back(byte as u8);
}

/// The I2C transaction waiting for the bus, at `scratch_ptr`: port, SDA GPIO, SCL GPIO (255 =
/// not routed), op count, then each op: 0 start | 1 write, ack_check, ack_exp, len, bytes… |
/// 2 read, len, nack | 3 stop | 4 end. Length 0 if none.
#[no_mangle]
pub unsafe extern "C" fn soc_i2c_take(soc: *const Soc) -> u32 {
    let soc = &*soc;
    let Some(port) = soc.pending_i2c() else { return scratch(vec![]) };
    let ops = soc.periph.i2c[port].pending.as_ref().unwrap();
    let (sda, scl) = soc.periph.i2c_pins(port);
    let mut out = vec![port as u8, sda.map_or(255, |n| n as u8), scl.map_or(255, |n| n as u8), ops.len() as u8];
    for op in ops {
        match op {
            Op::Start => out.push(0),
            Op::Write { bytes, ack_check, ack_exp } => {
                out.extend([1, *ack_check as u8, *ack_exp as u8, bytes.len() as u8]);
                out.extend(bytes);
            }
            Op::Read { len, nack } => out.extend([2, *len, *nack as u8]),
            Op::Stop => out.push(3),
            Op::End => out.push(4),
        }
    }
    scratch(out)
}

/// Answer the waiting I2C transaction: one byte per written byte (0 = ACK, 1 = NACK), then the
/// bytes read, in op order.
#[no_mangle]
pub unsafe extern "C" fn soc_i2c_answer(soc: *mut Soc, ptr: *const u8, len: u32) {
    let soc = &mut *soc;
    let Some(port) = soc.pending_i2c() else { return };
    let written: usize = soc.periph.i2c[port]
        .pending
        .as_ref()
        .unwrap()
        .iter()
        .map(|op| if let Op::Write { bytes, .. } = op { bytes.len() } else { 0 })
        .sum();
    let bytes = slice(ptr, len).unwrap_or(&[]);
    let (acks, data) = bytes.split_at(written.min(bytes.len()));
    soc.answer_i2c(&Reply { acks: acks.iter().map(|&a| a != 0).collect(), data: data.to_vec() });
}

/// Pad state bits: 0 output enabled, 1 level, 2 pull-up, 3 pull-down, 4 input enabled,
/// 8..9 drive strength.
#[no_mangle]
pub unsafe extern "C" fn soc_pad_state(soc: *const Soc, gpio: u32) -> u32 {
    let p = (*soc).periph.pad(gpio as usize % 40);
    (p.output_enabled as u32)
        | ((p.level as u32) << 1)
        | ((p.pull_up as u32) << 2)
        | ((p.pull_down as u32) << 3)
        | ((p.input_enabled as u32) << 4)
        | ((p.drive as u32) << 8)
}

/// PWM waveform on a pad, or 0 if none: the period in ns; `soc_pad_pwm_high` gives the time HIGH.
#[no_mangle]
pub unsafe extern "C" fn soc_pad_pwm_period(soc: *const Soc, gpio: u32) -> f64 {
    (*soc).periph.pad(gpio as usize % 40).pwm_period_ns as f64
}

#[no_mangle]
pub unsafe extern "C" fn soc_pad_pwm_high(soc: *const Soc, gpio: u32) -> f64 {
    (*soc).periph.pad(gpio as usize % 40).pwm_high_ns as f64
}

/// Logic level the circuit presents at a pad: 0, 1, or −1 to release (chip decides alone).
#[no_mangle]
pub unsafe extern "C" fn soc_set_pad_input(soc: *mut Soc, gpio: u32, level: i32) {
    (*soc).drive_pad(gpio as usize % 40, if level < 0 { None } else { Some(level != 0) });
}

/// Voltage the circuit presents at a pad, for the ADCs (analogRead).
#[no_mangle]
pub unsafe extern "C" fn soc_set_pad_volts(soc: *mut Soc, gpio: u32, volts: f64) {
    (*soc).set_pad_volts(gpio as usize % 40, volts);
}

/// Board-level pull-ups used when no circuit is attached; set 0 when the circuit models them.
#[no_mangle]
pub unsafe extern "C" fn soc_set_board_pull_ups(soc: *mut Soc, mask_lo: u32, mask_hi: u32) {
    (*soc).periph.gpio.board_pull_up = mask_lo as u64 | ((mask_hi as u64) << 32);
}
