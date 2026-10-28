# ESP32 Lab

Virtual ESP32 workbench: plug parts into a breadboard, wire them to a board and run the real
`firmware.elf` from the lessons in [`../lession`](../lession/PLAN.md) on an emulated ESP32.

- Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Adding parts: [docs/PART_AUTHORING.md](docs/PART_AUTHORING.md)

```bash
pnpm install
pnpm test        # netlist, circuit solver, parts, lesson checks
pnpm typecheck
```

Status: **M0**. The circuit core is done and tested; the Xtensa emulator (M1–M2) and the UI (M3)
are next.
