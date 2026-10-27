# YouTube Short script – Lesson 02: Button

Format: vertical 9:16, ~45 seconds. 🎥 = you film with a camera, 🖥️ = Claude records the screen.
Screen recordings live in `lession/02-button/recordings/` (1080x1920, no audio).

## Status
| Shot | File | Status |
|------|------|--------|
| 2 | `recordings/02-pullup-code.mp4` | ✅ 8.2s |
| 3 | `recordings/03-debounce-code.mp4` | ✅ 12.2s |
| 4 | `recordings/04-upload.mp4` | ✅ 34.9s (speed up x4–x6) |
| 5 | `recordings/05-press-monitor.mp4` | ✅ 45.6s – reset, then presses #1→#9 (trim the wait at the start) |
| 6a | `recordings/06a-set-debounce-0.mp4` | ✅ 14.9s – change `DEBOUNCE_MS` 50 → 0 |
| 6 | `recordings/06-no-debounce.mp4` | ⏳ filmed together with the camera |

| # | Type | Content | Length | Suggested voice-over |
|---|------|---------|--------|----------------------|
| 1 | 🎥 | Close-up of a finger pointing at the BOOT button | 3s | "No need to buy a button – the ESP32 has BOOT built in" |
| 2 | 🖥️ | `INPUT_PULLUP` code | 5s | "Released is HIGH, pressed is LOW" |
| 3 | 🖥️ | Debounce code in `main.cpp` | 8s | "Mechanical buttons bounce for a few ms – wait for them to settle" |
| 4 | 🖥️ | Upload `lesson02` to `SUCCESS` (sped up) | 4s | "Upload…" |
| 5 | 🎥 + 🖥️ | Press BOOT a few times: LED toggles, Serial prints `Press #n` (filmed together) | 8s | "Every press toggles the LED" |
| 6 | 🎥 + 🖥️ | `DEBOUNCE_MS = 0`: one press counts 2–3 times (if the board bounces) | 6s | "No debounce – one press counts as three!" |
| 7 | 🎥 | Outro: LED on, finger leaves the button | 3s | "Next: doing many things at once with millis()" |
