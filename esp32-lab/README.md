# ESP32 Lab

Virtual ESP32 workbench: plug parts into a breadboard, wire them to a board and run the real
`firmware.elf` from the lessons in [`../lession`](../lession/PLAN.md) on an emulated ESP32.

- Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Adding parts: [docs/PART_AUTHORING.md](docs/PART_AUTHORING.md)

```bash
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

Status: **M2**. The circuit core (M0), the Xtensa LX6 CPU (M1) and the ESP32 SoC (M2) are done:
the unmodified lesson firmware boots, prints its Serial output and drives GPIO2. Next is M3:
WASM build, wiring the SoC's pads to the circuit simulator, and the Svelte workbench.
