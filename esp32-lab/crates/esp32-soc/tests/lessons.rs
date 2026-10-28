//! Boot the real lesson firmware built by PlatformIO (`pio run -e lesson01`) and check what the
//! board would do. Skipped when the build output is missing.

use esp32_soc::{Soc, Stop, CPU_HZ};
use std::path::PathBuf;

fn build_dir(env: &str) -> Option<PathBuf> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../.pio/build").join(env);
    dir.join("firmware.elf").exists().then_some(dir)
}

fn boot(env: &str) -> Option<Soc> {
    let Some(dir) = build_dir(env) else {
        eprintln!("skipping: no PlatformIO build for {env} (run `pio run -e {env}`)");
        return None;
    };
    let read = |f: &str| std::fs::read(dir.join(f)).ok();
    Some(Soc::from_build(&read("firmware.elf")?, &read("firmware.bin")?, read("bootloader.bin").as_deref(), read("partitions.bin").as_deref()).unwrap())
}

#[test]
fn lesson01_prints_banner_and_blinks_gpio2() {
    let Some(mut soc) = boot("lesson01") else { return };
    assert_eq!(soc.run(4 * CPU_HZ), Stop::Timeout);
    let out = String::from_utf8_lossy(soc.uart_output(0)).into_owned();
    assert!(out.contains("=== Hello ESP32! ==="), "{out}");
    // "Key   : value" lines, compared without the column padding
    let field = |key: &str| {
        out.lines().find(|l| l.starts_with(key)).and_then(|l| l.split_once(':')).map(|(_, v)| v.trim().to_string())
    };
    assert_eq!(field("CPU cores").as_deref(), Some("2"));
    assert_eq!(field("CPU clock").as_deref(), Some("240 MHz"));
    assert_eq!(field("Flash").as_deref(), Some("4 MB"));
    assert_eq!(field("MAC address").as_deref(), Some("24:0A:C4:12:34:56"));
    assert!(!out.contains("CRC error"), "{out}");
    assert!(out.contains("[1] LED OFF"), "{out}");

    // GPIO2 edges: HIGH, then LOW 100 ms later, then HIGH again 2000 ms after that
    let edges: Vec<(f64, bool)> = soc
        .pad_events
        .iter()
        .filter(|e| e.gpio == 2 && e.state.output_enabled)
        .map(|e| (e.cycles as f64 / CPU_HZ as f64, e.state.level))
        .collect();
    let highs: Vec<f64> = edges.iter().filter(|e| e.1).map(|e| e.0).collect();
    let lows: Vec<f64> = edges.iter().filter(|e| !e.1).map(|e| e.0).skip_while(|&t| t < highs[0]).collect();
    assert!((highs[0] - 1.0).abs() < 0.05, "first HIGH after setup's delay(1000): {edges:?}");
    assert!((lows[0] - highs[0] - 0.1).abs() < 0.002, "delay(100): {edges:?}");
    assert!((highs[1] - lows[0] - 2.0).abs() < 0.002, "delay(2000): {edges:?}");
}

#[test]
fn lesson02_debounces_the_boot_button() {
    let Some(mut soc) = boot("lesson02") else { return };
    let at = |s: f64| (s * CPU_HZ as f64) as u64;
    soc.run(at(1.2));
    // A real 150 ms press toggles the LED…
    soc.drive_pad(0, Some(false));
    soc.run(at(1.35));
    soc.drive_pad(0, None);
    soc.run(at(1.5));
    // …a 20 ms blip is shorter than DEBOUNCE_MS = 50 and must be ignored
    soc.drive_pad(0, Some(false));
    soc.run(at(1.52));
    soc.drive_pad(0, None);
    assert_eq!(soc.run(at(1.7)), Stop::Timeout);

    let out = String::from_utf8_lossy(soc.uart_output(0)).into_owned();
    assert!(out.contains("Press #1 -> LED ON"), "{out}");
    assert!(!out.contains("Press #2"), "{out}");
    let led = soc.pad_events.iter().filter(|e| e.gpio == 2 && e.state.output_enabled).last().unwrap();
    assert!(led.state.level, "LED on after one press");
}
