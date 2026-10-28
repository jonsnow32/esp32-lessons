# Lesson 00 – PlatformIO Basics: New Project & Choosing a Board

## Goals
- Install PlatformIO in VS Code
- Create a new project and pick the right board (**Espressif ESP32 Dev Module**)
- Understand what is inside a PlatformIO project
- Know the toolbar buttons: Build, Upload, Serial Monitor

## You need
- VS Code
- Your ESP32 board + a USB C-C data cable (only for Upload/Monitor)

## 1. Install PlatformIO
1. Open VS Code → **Extensions** (⇧⌘X).
2. Search for **PlatformIO IDE** → **Install**.
3. Wait for it to finish installing PlatformIO Core (a few minutes the first time), then reload VS Code.
4. An alien-head icon appears in the left activity bar – that is PlatformIO.

## 2. Create a new project
1. Click the **alien icon** → **Create New Project** (or *PIO Home → New Project*).
2. Fill in the **Project Wizard**:

| Field | Value | Why |
|-------|-------|-----|
| Name | `my-first-esp32` | Any name, no spaces is easiest |
| Board | type `esp32 dev` → pick **Espressif ESP32 Dev Module** | The generic board ID `esp32dev` works for almost every ESP32-D/WROOM-32 dev board |
| Framework | **Arduino** (filled in automatically) | Lets you use `setup()`, `loop()`, `digitalWrite()`… |
| Location | ✅ Use default location | Projects go to `~/Documents/PlatformIO/Projects/` |

3. Click **Finish**. The first time, PlatformIO downloads the ESP32 toolchain (can take several minutes); after that it takes seconds.

> **Which board should I choose?** If the module on your board says **ESP32-WROOM-32** (or 32D/32E), choose *Espressif ESP32 Dev Module*. Boards like ESP32-S3, ESP32-C3 have their own entries – the wrong board compiles fine but won't upload or won't run correctly.

## 3. What's inside a project
```
my-first-esp32/
├── platformio.ini   ← project settings: board, framework, speeds
├── src/main.cpp     ← your code
├── include/         ← your own header files (.h)
├── lib/             ← your own libraries
├── test/            ← unit tests
└── .pio/            ← build output (generated, don't edit)
```

`platformio.ini` created by the wizard:
```ini
[env:esp32dev]
platform = espressif32   ; chip family
board = esp32dev         ; the board you picked
framework = arduino
```

Lines worth adding right away:
```ini
monitor_speed = 115200   ; must match Serial.begin(115200)
upload_speed = 460800    ; 921600 can fail on some boards
```

## 4. The toolbar (bottom status bar)
| Icon | Name | What it does |
|------|------|--------------|
| ✓ | **Build** | Compile only – checks your code for errors |
| → | **Upload** | Compile + flash to the board |
| 🔌 | **Serial Monitor** | Open the Serial console (Ctrl+C to quit) |
| 🗑 | Clean | Delete build files |
| `Default (my-first-esp32)` | Environment picker | Choose which `[env:...]` to build – this repo has one per lesson |

Build output ends with `[SUCCESS]` and shows how much RAM/Flash your program uses.

## 5. How this repo uses PlatformIO
Everything lives in **one** project with one environment per lesson (`lesson01`, `lesson02`, …). Pick the lesson in the environment picker, then press Upload. See [Lesson 01](../01-hello-esp32/README.md).

## Exercises
1. Create your own project, paste the Lesson 01 blink code into `src/main.cpp`, and upload it.
2. Open **PIO Home → Boards**, search `esp32` and see how many ESP32 boards PlatformIO supports.
3. Change `board = esp32dev` to a wrong board (e.g. `esp32-s3-devkitc-1`) and build – what happens? Change it back.
