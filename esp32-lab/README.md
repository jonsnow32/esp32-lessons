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

# Check the decoder against GNU objdump on a real firmware
~/.platformio/packages/toolchain-xtensa-esp-elf/bin/xtensa-esp32-elf-objdump -d \
  ../.pio/build/lesson01/firmware.elf | cargo run -q -p esp32-cli -- disasm-check
```

Status: **M1**. The circuit core (M0) and the Xtensa LX6 CPU (M1) are done and tested. Next is
the ESP32 SoC (M2): memory map, peripherals, and booting the lesson ELFs.
