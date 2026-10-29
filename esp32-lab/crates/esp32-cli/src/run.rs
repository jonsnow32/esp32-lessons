//! `esp32-cli run <pio-build-dir> [--seconds N] [--trace-gpio] [--press GPIO@START-END ...]
//! [--volts GPIO=V ...]`: boot a PlatformIO build (firmware.elf + firmware.bin + bootloader.bin +
//! partitions.bin) and print what UART0 says. `--press 0@2.0-2.3` holds GPIO0 (the BOOT button)
//! LOW from 2.0 s to 2.3 s; `--volts 34=1.65` puts 1.65 V on GPIO34 for the ADC.

use esp32_soc::{Soc, Stop, CPU_HZ};
use std::io::Write;
use std::path::Path;

pub fn run(args: &[String]) -> i32 {
    let Some(dir) = args.first() else {
        eprintln!("usage: esp32-cli run <.pio/build/ENV> [--seconds N] [--trace-gpio]");
        return 2;
    };
    let seconds: f64 = args.iter().position(|a| a == "--seconds").and_then(|i| args.get(i + 1)).and_then(|s| s.parse().ok()).unwrap_or(3.0);
    let trace_gpio = args.iter().any(|a| a == "--trace-gpio");
    // (gpio, start s, end s)
    let presses: Vec<(usize, f64, f64)> = args
        .windows(2)
        .filter(|w| w[0] == "--press")
        .filter_map(|w| {
            let (pin, span) = w[1].split_once('@')?;
            let (a, b) = span.split_once('-')?;
            Some((pin.parse().ok()?, a.parse().ok()?, b.parse().ok()?))
        })
        .collect();
    // Edges to apply, in time order: (cycle, gpio, Some(LOW) or None = release)
    let mut edges: Vec<(u64, usize, Option<bool>)> = presses
        .iter()
        .flat_map(|&(g, a, b)| [((a * CPU_HZ as f64) as u64, g, Some(false)), ((b * CPU_HZ as f64) as u64, g, None)])
        .collect();
    edges.sort_by_key(|e| e.0);
    let volts: Vec<(usize, f64)> = args
        .windows(2)
        .filter(|w| w[0] == "--volts")
        .filter_map(|w| {
            let (pin, v) = w[1].split_once('=')?;
            Some((pin.parse().ok()?, v.parse().ok()?))
        })
        .collect();
    let mut next_edge = 0;
    let dir = Path::new(dir);
    let read = |f: &str| std::fs::read(dir.join(f)).ok();
    let (Some(elf), Some(bin)) = (read("firmware.elf"), read("firmware.bin")) else {
        eprintln!("{} must contain firmware.elf and firmware.bin", dir.display());
        return 2;
    };
    let mut soc = match Soc::from_build(&elf, &bin, read("bootloader.bin").as_deref(), read("partitions.bin").as_deref()) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("boot failed: {e}");
            return 1;
        }
    };

    for &(gpio, v) in &volts {
        soc.set_pad_volts(gpio, v);
    }

    let started = std::time::Instant::now();
    let end = (seconds * CPU_HZ as f64) as u64;
    let mut printed = 0;
    let mut pads_printed = 0;
    let stop = loop {
        let mut slice = (soc.cycles + CPU_HZ / 100).min(end);
        if let Some(e) = edges.get(next_edge) {
            if e.0 <= soc.cycles {
                soc.drive_pad(e.1, e.2);
                next_edge += 1;
                continue;
            }
            slice = slice.min(e.0);
        }
        let stop = soc.run(slice);
        let out = soc.uart_output(0);
        std::io::stdout().write_all(&out[printed..]).unwrap();
        std::io::stdout().flush().unwrap();
        printed = out.len();
        if trace_gpio {
            for e in &soc.pad_events[pads_printed..] {
                let level = if e.state.pwm_period_ns > 0 {
                    let (period, high) = (e.state.pwm_period_ns as f64, e.state.pwm_high_ns as f64);
                    format!("PWM {:.1} Hz, HIGH {:.1} µs ({:.1} %)", 1e9 / period, high / 1e3, 100.0 * high / period)
                } else if e.state.level {
                    "HIGH".into()
                } else {
                    "LOW".into()
                };
                eprintln!(
                    "[{:10.6} s] GPIO{:<2} {} {}",
                    e.cycles as f64 / CPU_HZ as f64,
                    e.gpio,
                    if e.state.output_enabled { "OUT" } else { "in " },
                    level
                );
            }
            pads_printed = soc.pad_events.len();
        }
        if stop != Stop::Timeout || soc.cycles >= end {
            break stop;
        }
    };

    let wall = started.elapsed().as_secs_f64();
    let instructions: u64 = soc.cpus.iter().map(|c| c.retired).sum();
    eprintln!();
    eprintln!("--- stopped: {stop:?}");
    eprintln!(
        "--- {:.3} s simulated in {:.2} s ({:.1} M instructions, {:.1} MIPS), APP_CPU {}",
        soc.cycles as f64 / CPU_HZ as f64,
        wall,
        instructions as f64 / 1e6,
        instructions as f64 / 1e6 / wall,
        if soc.running[1] { "running" } else { "not started" }
    );
    for (k, cpu) in soc.cpus.iter().enumerate() {
        eprintln!(
            "--- cpu{k}: pc={:08x} ps={:08x} exccause={} excvaddr={:08x} epc1={:08x} a0={:08x} a1={:08x}",
            cpu.pc, cpu.ps, cpu.exccause, cpu.excvaddr, cpu.epc[1], cpu.a(0), cpu.a(1)
        );
    }
    if !soc.exceptions.is_empty() {
        eprintln!("--- {} exceptions, first: {:?}", soc.exceptions.len(), &soc.exceptions[..soc.exceptions.len().min(5)]);
    }
    // Group consecutive registers so large tables read as one range
    let mut groups: Vec<(u32, u32, u32, u32)> = vec![];
    for (&a, &(r, w)) in &soc.periph.unmodelled {
        match groups.last_mut() {
            Some(g) if g.1 + 4 == a => {
                g.1 = a;
                g.2 += r;
                g.3 += w;
            }
            _ => groups.push((a, a, r, w)),
        }
    }
    let text: Vec<String> = groups
        .iter()
        .map(|(a, b, r, w)| if a == b { format!("{a:08x}(r{r} w{w})") } else { format!("{a:08x}-{b:08x}(r{r} w{w})") })
        .collect();
    eprintln!("--- unmodelled registers: {}", text.join(" "));
    let mut calls: Vec<_> = soc.rom.calls.iter().collect();
    calls.sort_by(|a, b| b.1.cmp(a.1));
    let calls: Vec<String> = calls.iter().map(|(n, c)| format!("{n}×{c}")).collect();
    eprintln!("--- ROM calls: {}", calls.join(" "));
    match stop {
        Stop::Timeout => 0,
        _ => 1,
    }
}
