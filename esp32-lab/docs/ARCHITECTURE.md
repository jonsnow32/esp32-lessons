# ESP32 Lab – Architecture

ESP32 Lab is a virtual workbench where learners plug parts into a breadboard, wire them to an
ESP32 board and run **the same `firmware.elf` PlatformIO builds for the real board**. Two rules
drive the design:

1. **Real logic, not scripted lessons.** Firmware runs on an emulated Xtensa LX6 CPU with
   register-accurate peripherals (ESP32 Technical Reference Manual). The circuit is solved with
   Modified Nodal Analysis, the method SPICE uses. Nothing is special-cased per lesson.
2. **Everything is a component.** Parts, boards, breadboards, MCUs, instruments, lessons and
   projects are data + plug-in modules behind small interfaces. Adding a DHT22 means adding
   `parts/dht22/`, not editing the core.

## Layers

```
UI thread (Svelte)                     Sim Worker (Web Worker)
┌──────────────────────┐   messages   ┌──────────────────────────────────────┐
│ Workbench (SVG)      │◄────────────►│ SimKernel (TS): virtual clock, events │
│ Library / Inspector  │  SharedArray │  ├─ Netlist (Union-Find)              │
│ Lesson panel, checks │◄═ probes ═══►│  ├─ Circuit solver (MNA + Newton)     │
│ Serial / Scope / LA  │   ringbuf    │  ├─ Part behaviors (TS plugins)       │
└──────────────────────┘              │  └─ MCU adapter ──► esp32-emu (WASM)  │
                                      │        Xtensa LX6 ×2, MMU/cache,      │
                                      │        interrupt matrix, peripherals  │
                                      └──────────────────────────────────────┘
```

| Package | Role | Status |
|---|---|---|
| `packages/part-sdk` | Part contract: manifest, `PartBehavior`, stamping contexts, helpers (`pnjlim`, `Overstress`) | M0 ✅ |
| `packages/project-model` | Serialisable `Project`, `BoardDef`, `BreadboardDef`, placement, migrations | M0 ✅ |
| `packages/sim-core` | `SimKernel`, `Netlist`, MNA solver, `McuModel` interface, `ScriptedMcu`, pad/supply builtins | M0 ✅ |
| `packages/lesson-engine` | Evaluates declarative lesson checks | M0 ✅ |
| `packages/mcu-esp32` | ESP32 pad capabilities; `Esp32Mcu`: the WASM emulator as an `McuModel` | M3 ✅ |
| `parts/*` | One package per part (`resistor`, `led`, `pushbutton`) | M0 ✅ |
| `boards/*`, `breadboards/*`, `lessons/*` | Pure JSON definitions | M0 ✅ |
| `crates/xtensa-core` | Xtensa LX6 decoder, objdump-syntax disassembler, interpreter | M1 ✅ |
| `crates/esp32-soc` | Memory map + flash MMU, two cores, interrupt matrix, peripherals, ROM HLE, direct boot | M2 ✅ |
| `crates/esp32-cli` | Headless tools: `disasm-check`, `run` | M1–M2 ✅ |
| `crates/esp32-wasm` | Browser binding: plain C-ABI exports, no wasm-bindgen (`scripts/build-wasm.sh`) | M3 ✅ |
| `packages/app` | Svelte workbench; simulation in a Web Worker | M3 ✅ (first version) |

## The pad boundary

The only thing firmware and circuit exchange is the state of the chip's **pads**.

- **Chip → circuit:** `PadDrive { output: high|low|z, pull: up|down|none, strength }`. The kernel
  turns each pad into a Thevenin output stage (`padBehavior` in `sim-core/src/builtins.ts`): on-
  resistance to VDD/GND per drive strength, ~45 kΩ pull resistors, all tied to the board's real
  3V3 net, so a sagging regulator really lowers VOH.
- **Circuit → chip:** `PadInput { volts, floating }` after each solve. The MCU applies its own
  input thresholds (ESP32: VIL ≤ 0.25·VDD, VIH ≥ 0.75·VDD with hysteresis). ADC peripherals sample
  `volts` through their attenuation curve.

As a result, pull-ups, a reversed LED, a missing resistor, a floating input or a short all behave
physically, without any rules written for them. `McuModel` (`sim-core/src/mcu.ts`) is the whole
contract; `ScriptedMcu` implements it for tests, and the Xtensa emulator will implement it the
same way.

## Time

- Virtual time in nanoseconds (`SimTime`). The simulation is not tied to wall-clock time; the UI
  picks a speed factor.
- `SimKernel.advanceTo(t)` loop: let the MCU run until the next part timer (or until a pad drive
  changes) → fire due part timers (button bounce…) → re-solve if anything changed → hand pad
  voltages back to the MCU.
- Before time moves on, every part gets `onSolved` with the elapsed `dt` spent at the previous
  operating point. That is how overstress accumulates (an LED on a bare GPIO dies after ~50 ms
  above 30 mA; straight across 3V3 it dies at once).
- Planned: the CPU runs in quanta of ≤10 µs between syncs; high-frequency PWM uses a periodic
  descriptor `{freq, duty}` so the solver averages two states instead of solving every edge.

## Netlist

Every connection point has a string key:

| Key | Meaning |
|---|---|
| `h:<bb>:<hole>` | Breadboard hole, e.g. `h:bb1:a12` |
| `bp:<pin>` | Board header pin, e.g. `bp:D18` |
| `pad:<pad>` | MCU pad, e.g. `pad:GPIO18` |
| `net:<name>` | Board-wide net (`net:GND`, `net:3V3`, `net:5V`) |
| `p:<part>:<terminal>` | Part terminal; onboard parts are `p:board.<id>:<terminal>` |
| `n:board:<node>` | Private node on the board (between onboard LED and its resistor) |

Union-Find merges keys for breadboard strips, plugged legs, wires, header-pin→pad mappings and
in-part shorts (`internalShorts`, e.g. pushbutton legs). The frozen `Netlist` maps each key to a
net index; **net 0 is always ground**. It is rebuilt from scratch on every edit, in near-linear
time.

## Circuit solver

`sim-core/src/mna.ts`. Unknowns are node voltages plus one current per ideal voltage source.

- Parts stamp by terminal name: `ctx.conductance(a, b, g)`, `ctx.current(a, b, i)` (pushes `i` from
  a to b through the part), `ctx.voltageSource(p, m, v)`.
- Nonlinear parts stamp a companion model around the previous iterate (`stampNonlinear`), and
  Newton-Raphson repeats until node voltages move < 1 µV **and** no part had to limit its step
  (`ctx.limited()`, set when `pnjlim` clamps a junction voltage).
- A 1 pS `G_MIN` from every node to ground keeps the matrix regular. Nodes whose real conductance
  is below 1 nS are reported as `floating`, which the MCU turns into an undefined input.
- Dense Gaussian elimination with partial pivoting: lesson circuits have tens of nodes. Switch to
  sparse LU when circuits grow past ~200 nodes.
- Supplies are Norton sources (`supplyBehavior`), so no branch variables are needed for them.

## Component model

### Part = manifest + behavior + view

`part.json` (static, validated, versioned):

```json
{
  "id": "led", "version": "0.1.0", "name": "LED 5 mm", "category": "output",
  "terminals": [{ "name": "anode", "dx": 0, "dy": 0 }, { "name": "cathode", "dx": 1, "dy": 0 }],
  "props": { "color": { "type": "enum", "default": "red", "options": ["red", "blue"] } },
  "ratings": { "currentMax": 0.03, "currentAbsMax": 0.1, "reverseVoltageMax": 5, "overstressTime": 50000000 }
}
```

- `terminals[].dx/dy` are offsets in breadboard pitches (2.54 mm) from the first terminal. The
  placement code rotates them in 90° steps and checks that every leg lands in a hole.
- `internalShorts` declares legs that are always joined.

`index.ts` exports a `PartModule { manifest, create(props, env) }`. `create` returns a
`PartBehavior`:

| Method | Called | Use |
|---|---|---|
| `stamp(ctx)` | every Newton iteration | linear elements |
| `stampNonlinear(ctx)` | every Newton iteration | diodes, transistors; `ctx.v()` gives the previous iterate |
| `onSolved(op)` | after each converged solve, and with `dt` as time passes | observables, ratings, damage |
| `onEvent(ev)` | user press/release, own timers, property changes | switches, bounce, sensors |
| `observables()` | any time | values for the view, instruments and lesson checks |

`PartEnv` gives each part `now()`, `schedule(at, tag)`, a seeded `random()` (runs are
reproducible) and `invalidate()` (ask for a re-solve). See [PART_AUTHORING.md](PART_AUTHORING.md).

Planned extension: protocol devices (I2C/SPI/1-Wire sensors, displays) implement `BusDevice` on
top of `PartBehavior`. They are driven at edge level, and switch to a transaction-level fast path
once the bus is electrically valid (pull-ups present, unique addresses).

### Board

`boards/<id>/board.json`: `mcu`, header `pins` (label, position, connection to a pad or net),
`supplies` (USB 5 V, AMS1117 3.3 V with output resistance and current limit) and `onboard` parts.
Onboard parts are ordinary parts. The DevKit's blue LED is `led` + `resistor` on GPIO2, and BOOT
and EN are `pushbutton`s with 10 kΩ pull-ups, so lesson 02's BOOT button bounces like the real one.

### Breadboard

`breadboards/<id>/breadboard.json` is compact: column count, terminal blocks (`rows`, `y0`) and
rails (grouped holes). `expandBreadboard` produces holes, positions and metal strips.

### MCU

`McuModel`: `pads`, `electrical`, `drive(pad)`, `setInputs(inputs, t)`, `runUntil(t)`, optional
`padDamaged`, `onSerial`. Pad capabilities (strapping, input-only, flash, ADC1/ADC2, touch, DAC)
live in `packages/mcu-esp32/pads.json`, used by the UI and by lesson checks.

### Project

```ts
{ schemaVersion: 1, board: { type, x, y }, breadboards: [{ id, type, x, y }],
  parts: [{ id, type, props, placement: { bb, hole, rot } | null }],
  wires: [{ id, a: Endpoint, b: Endpoint, color }],
  firmware: { kind: 'pio-env', env } | { kind: 'elf', url } | { kind: 'none' },
  lessonId, seed }
```

`Endpoint` = hole, board pin or part terminal. `migrate()` upgrades older saves step by step.
Projects are plain JSON: localStorage first, Postgres JSONB later.

### Lesson

`lessons/<id>/lesson.json` links to the course text in `lession/`, names the PlatformIO env whose
ELF it runs, ships a template project, and lists steps/exercises with declarative checks:

| Check | Kind |
|---|---|
| `connected` | two nodes are the same net |
| `series` | path from → parts (by type, optional entry/exit terminal for polarity) → to, `order: any` |
| `noShort` | supply nets not merged with GND |
| `avoidPads` | no user wiring on given pads (input-only, flash, strapping) |
| `notDamaged` | nothing has burnt out |
| `observable` | compare a part observable (`board.led.brightness > 0`) |
| `serialMatches` | regex over UART0 output |

Planned: `signal` (a pad toggles with a period in a range, measured from the pad trace).

## ESP32 emulator (Rust → WASM)

Order of work is set by what Arduino-ESP32 needs to reach `setup()`:

1. **`xtensa-core`** – 24/16-bit (density) decode; ALU, load/store, branches; windowed registers
   (64 AR, WindowBase/WindowStart, overflow/underflow exceptions, `ENTRY`/`RETW`); special/user
   registers (PS, EPC/EPS, EXCSAVE, SAR, LBEG/LEND/LCOUNT zero-overhead loops, CCOUNT,
   CCOMPARE0–2, INTENABLE/INTERRUPT); MUL/MULL/QUOS/REMS; boolean regs; `S32C1I`/SCOMPARE1
   (FreeRTOS spinlocks). FPU after that.
2. **`esp32-soc`** – memory map (IRAM, DRAM, RTC FAST/SLOW, ROM, flash cache windows IROM
   `0x400D_0000` / DROM `0x3F40_0000` with MMU tables), PRO and APP cores (Arduino's `loopTask`
   runs on core 1), interrupt matrix, DPORT (APP_CPU start), **direct boot**: load the app ELF's
   segments and jump to its entry, skipping the second-stage bootloader (like QEMU `-kernel`).
   ROM functions come from Espressif's published ROM ELFs (`esp-rom-elfs`); check the licence
   before bundling, otherwise the user supplies them.
3. **`esp32-periph`** – one `MmioDevice { read, write, next_event, tick }` per peripheral, register
   constants from the TRM/SVD, in the order firmware touches them: EFUSE (MAC, chip rev),
   RTC_CNTL + TIMG (watchdogs), UART0, GPIO + IO_MUX + GPIO matrix, FRC/esp_timer (millis/micros),
   LEDC, SENS (ADC/touch), I2C, SPI, RMT.
4. **WiFi/BLE** – the radio is not emulated. A later shim at the driver or lwIP level provides a
   virtual network.

### What M2 implements (`crates/esp32-soc`)

- **Direct boot** (`soc.rs`): the flash image is assembled as esptool writes it (bootloader
  0x1000, partitions 0x8000, app 0x10000); then the second-stage bootloader's job is done in
  Rust: RAM segments of `firmware.bin` are copied, flash segments are mapped through the MMU
  tables, and PRO_CPU starts at the entry point as if called with CALLX8. APP_CPU starts when the
  firmware releases it through DPORT and sets its boot address.
- **ROM HLE** (`rom.rs`): the mask ROM is not shipped with firmware, so calls into
  0x4000_0000–0x4006_FFFF are intercepted. The firmware's own symbol table names the function
  (all aliases, e.g. `esp_rom_get_reset_reason` = `rtc_get_reset_reason`), and it runs in Rust
  as one atomic call (arguments from the callee's a2…, result in a2/a3, return as RETW would).
  Implemented: console (`ets_printf` with a printf formatter), delays (the core stalls for the
  right number of cycles), CPU tick bookkeeping (`g_ticks_per_us_*`), GPIO/interrupt matrix
  helpers, analog I2C registers, CRC32/CRC8/MD5, libc memory/string functions, libgcc 64-bit
  integer and soft-double helpers, and newlib syscalls forwarded as tail calls to the firmware's
  `_open_r`, `_write_r`, ... An unimplemented ROM function stops the run with its name.
- **Peripherals** (`periph/`): UART0–2 (TX captured, RX queue, interrupts), GPIO + IO_MUX +
  RTCIO pulls (pad state for the circuit simulator), timer groups (T0/T1, LAC timer used by
  `esp_timer`/`millis()`, RTC clock calibration), SPI0/SPI1 flash controller with a 4 MB flash
  chip (user-mode and native commands; erase/program obey write-enable), DPORT interrupt matrix
  and cross-core interrupts, APP_CPU control, cache state, eFuse (MAC with valid CRC, chip
  revision), RNG, RTC_CNTL presets. Unmodelled registers act as storage and are listed after a
  run (`esp32-cli run` prints them), which is the to-do list for new firmware.
- **Scheduling**: both cores run in 64-instruction quanta; interrupts are re-evaluated between
  quanta; when both cores sit in WAITI the clock jumps to the next timer event (never past a
  latched interrupt).

Known gaps: the clock tree is fixed at CPU 240 MHz / APB 80 MHz (frequency switches are
bookkept, not simulated); UART TX is instantaneous (no baud-rate timing); watchdogs never fire;
region protection (null-pointer traps) is stored but not enforced; no WiFi/BT; speed is
~25–35 MIPS, so busy-looping sketches (lessons 02/03) run ~6× slower than real time while
delay()-based ones (lesson 01) run ~9× faster. A decoded-instruction cache is the next speed-up.

## Verification strategy

- `pnpm test` – Vitest for netlist, solver, parts, lessons (`test/`).
- `cargo test` – decoder unit tests, plus bare-metal programs in
  `crates/xtensa-core/tests/asm/` assembled with the real `xtensa-esp32-elf` toolchain (recursive
  CALL8/CALL12 with window spill/fill, zero-overhead loops, division, S32C1I, CCOMPARE interrupt
  out of WAITI, FPU and the coprocessor-disabled trap). Skipped if the toolchain is missing.
- Decoder vs. GNU objdump on every instruction of a real firmware:
  `xtensa-esp32-elf-objdump -d firmware.elf | cargo run -p esp32-cli -- disasm-check`.
  Lessons 01–03: 0 mismatches over ~80k instructions each. Remaining "unsupported" lines are
  MAC16, TLB ops, ESP32 double-precision assist ops (`f64*`) and literal-pool data.
- Differential testing against Espressif's QEMU (`qemu-system-xtensa -machine esp32`, local only):
  step the same ELF on both and compare PC and register traces.
- Firmware: `pio run -e lesson01` then `esp32-cli run .pio/build/lesson01 --seconds 5 --trace-gpio`
  (`--press 0@2.0-2.3` holds the BOOT button). `crates/esp32-soc/tests/lessons.rs` boots the real
  lesson 01/02 builds: banner, chip info and MAC; GPIO2 HIGH at 1.0 s, LOW 100 ms later, HIGH
  2000 ms after that (±2 ms); a 150 ms BOOT press toggles the LED and a 20 ms blip is debounced.
- Hardware conformance: the same ELF on a real ESP32-D and on the emulator. Compare serial logs
  and pin timing, then store the result as a golden test.

## Milestones

- **M0** ✅ – monorepo, Part SDK, project model, netlist, MNA + Newton, resistor/LED/pushbutton,
  DevKit V1, half-400, lessons 01/02, lesson engine, tests.
- **M1** ✅ – `xtensa-core` (decode, disassemble, execute: windowed calls, exceptions, interrupts,
  CCOMPARE timers, loops, booleans, FPU) + `esp32-cli disasm-check`. Not yet: MAC16, `f64*`
  double-precision assist ops, a cycle-accurate timing model (1 cycle/instruction for now),
  differential runs against QEMU.
- **M2** ✅ – `esp32-soc`: the unmodified lesson 01, 02, 03 and 03_blocking builds boot on
  both cores, print exactly what the Serial Monitor shows, blink GPIO2 with correct timing and
  react to the BOOT button with real debounce behaviour.
- **M3** ✅ (first version) – decoded-instruction cache (23 → 62 MIPS); emulator as a 160 KB
  WASM module; `Esp32Mcu` re-solves the circuit on every pad edge; Svelte workbench with the
  kernel + emulator in a Web Worker paced to wall-clock time (lesson 01 runs at 1.0× real
  time in Chrome). Drag parts onto the breadboard, wire holes and header pins, press the board's
  BOOT/EN buttons, edit part props, live per-part current/brightness, net highlighting on hover,
  lesson checklist evaluated live, Serial Monitor (TX and RX). `vite dev` serves `.pio/build/*`
  so whatever `pio run` built is selectable. Still to do: board/breadboard selection beyond the
  one of each, undo, multimeter/scope instruments, nicer part artwork, touch-friendly dragging.
- **M4** – LEDC, ADC, touch, I2C; potentiometer and SSD1306 parts; lessons 04–09.
