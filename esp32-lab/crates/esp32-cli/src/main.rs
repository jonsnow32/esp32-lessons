//! esp32-cli – headless tools around the emulator.
//!
//!   esp32-cli disasm-check < objdump.txt    compare our decoder with GNU objdump

mod disasm_check;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = match args.first().map(String::as_str) {
        Some("disasm-check") => disasm_check::run(),
        _ => {
            eprintln!("usage: esp32-cli disasm-check < objdump.txt");
            2
        }
    };
    std::process::exit(code);
}
