# ESP32 Lab

Virtual ESP32 workbench: plug parts into a breadboard, wire them to a board and run the real
`firmware.elf` from the lessons in [`../lession`](../lession/PLAN.md) on an emulated ESP32.

- Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Adding parts: [docs/PART_AUTHORING.md](docs/PART_AUTHORING.md)

```bash
# The workbench in the browser (build the emulator once, and the lessons with `pio run`)
./scripts/build-wasm.sh            # needs rustup's wasm32-unknown-unknown target
pnpm -C packages/app dev           # http://localhost:5173
# In the app: ▴ Code opens the editor; ▶ Build & Run (Ctrl/⌘+Enter) compiles main.cpp with
# PlatformIO on this machine (~7–11 s) and runs it on the emulated board

pnpm install
pnpm test        # netlist, circuit solver, parts, lesson checks
pnpm typecheck
cargo test       # Xtensa decoder + interpreter (bare-metal tests need the PlatformIO toolchain)

# Boot a lesson's real firmware (after `pio run -e lesson02` in the parent project)
cargo run --release -p esp32-cli -- run ../.pio/build/lesson02 --seconds 4 --press 0@2.0-2.3 --trace-gpio

# Check the decoder against GNU objdump on a real firmware
~/.platformio/packages/toolchain-xtensa-esp-elf/bin/xtensa-esp32-elf-objdump -d \
  ../.pio/build/lesson01/firmware.elf | cargo run -q -p esp32-cli -- disasm-check
```

Status: **M3 (first version)**. The unmodified lesson firmware runs on the emulated ESP32 in the
browser, its pins drive the circuit simulator, and parts on the breadboard respond physically.
