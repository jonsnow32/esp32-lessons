//! esp32-cli – headless tools around the emulator.
//!
//!   esp32-cli disasm-check < objdump.txt    compare our decoder with GNU objdump
//!   esp32-cli run <.pio/build/ENV>          boot a PlatformIO build and show UART0

mod disasm_check;
mod run;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = match args.first().map(String::as_str) {
        Some("disasm-check") => disasm_check::run(),
        Some("run") => run::run(&args[1..]),
        _ => {
            eprintln!("usage: esp32-cli disasm-check < objdump.txt | run <.pio/build/ENV>");
            2
        }
    };
    std::process::exit(code);
}
