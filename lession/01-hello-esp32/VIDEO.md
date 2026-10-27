# YouTube Short script – Lesson 01: Hello ESP32

Format: vertical 9:16, ~45–60 seconds. 🎥 = you film with a camera, 🖥️ = Claude records the screen.
Screen recordings live in `lession/01-hello-esp32/recordings/` (1080x1920, 30fps, no audio).

## Status
| Shot | File | Status |
|------|------|--------|
| 3 | `recordings/03-find-port.mp4` | ✅ 9.8s |
| 4 | `recordings/04-read-code.mp4` | ✅ 14.3s |
| 5 | `recordings/05-upload.mp4` | ✅ 23.2s (speed up x2–x3 during "Writing") |
| 8 | `recordings/08-serial-monitor.mp4` | ✅ 19.8s – reset, chip info, then `LED ON/OFF` |
| 9 | `recordings/09-reset-en.mp4` | ⏳ filmed together with the camera |

| # | Type | Content | Length | Suggested voice-over |
|---|------|---------|--------|----------------------|
| 1 | 🎥 | Close-up of the ESP32 board + Type-C cable on the desk, flip front/back | 3–4s | "ESP32 – a microcontroller with WiFi + Bluetooth for a few dollars" |
| 2 | 🎥 | Plug the cable into the board and the Mac, red LED lights up | 3s | "Plug it in – red LED means power" |
| 3 | 🖥️ | Terminal: `ls /dev/cu.*` → the usbserial port appears | 4s | "The Mac sees the upload port" |
| 4 | 🖥️ | Terminal: `bat` shows `setup()` then `loop()` (syntax highlighted) | 8s | "setup runs once, loop runs forever" |
| 5 | 🖥️ | Upload, log runs to `SUCCESS` | 6s | "Upload the code…" |
| 6 | 🎥 | (If upload fails) finger holding BOOT | 2s | "Stuck at Connecting? Hold BOOT" |
| 7 | 🎥 | Blue LED blinking on the board | 4s | "And the LED blinks!" |
| 8 | 🖥️ | Serial Monitor shows chip info + `LED ON/OFF` | 6s | "Serial tells us: dual core, 240MHz" |
| 9 | 🎥 | Press EN – the board restarts | 2s | "EN resets the board" |
| 10 | 🎥/🖥️ | Split screen: LED blinking + Serial in sync | 4s | "Next: buttons. Follow for more!" |

## Filming tips
- Camera: shoot vertically, dark background so the LED pops, lock exposure (tap and hold on iPhone) so the LED doesn't blow out.
- For shots 7 & 9, roll 2–3 seconds before acting so they're easy to trim.
