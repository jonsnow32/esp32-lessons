# YouTube Short script – Lesson 03: millis()

Format: vertical 9:16, ~50 seconds. 🎥 = you film with a camera, 🖥️ = Claude records the screen.
Screen recordings live in `lession/03-millis/recordings/` (1080x1920, no audio).

| # | Type | Content | Length | Suggested voice-over |
|---|------|---------|--------|----------------------|
| 1 | 🖥️ | `blocking-demo` code: two `delay(1000)` before reading the button | 5s | "Most beginners write this…" |
| 2 | 🎥 + 🖥️ | Upload `lesson03_blocking`, press BOOT fast 5 times → Serial barely counts | 8s | "5 presses, counted… 0!" |
| 3 | 🖥️ | `updateLed()` code with `if (now - lastBlinkTime >= interval)` | 6s | "Don't wait – glance at the clock" |
| 4 | 🖥️ | `loop()` calling 3 functions | 4s | "3 tasks in parallel" |
| 5 | 🎥 + 🖥️ | Upload `lesson03`, press BOOT: LED goes SLOW → MEDIUM → FAST → OFF instantly, Serial prints the mode + the 5-second line | 12s | "Press and it changes instantly" |
| 6 | 🎥 | Outro: close-up of the LED blinking FAST | 3s | "Next: turn a wire into a touch button" |
