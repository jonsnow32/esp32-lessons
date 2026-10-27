# Lesson 03 – Non-blocking code with `millis()`

## Goals
- Understand why `delay()` "freezes" your program
- Use `millis()` to do **several things at once**
- Learn the "is it time yet?" pattern – reused in every later lesson (WiFi, sensors, MQTT…)

## You need
Just the board (GPIO2 LED + BOOT button).

## 1. The problem with `delay()`

Try the **wrong** version in [blocking-demo/main.cpp](blocking-demo/main.cpp) (env `lesson03_blocking`):

```cpp
void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(1000);                 // ← the ESP32 just sits and waits for 1 second
  digitalWrite(LED_PIN, LOW);
  delay(1000);                 // ← and another second
  if (digitalRead(BUTTON_PIN) == LOW) { ... }   // read only once every 2 s
}
```

Press BOOT quickly 5 times → almost **none get counted**. To be counted you have to be holding the button at the exact moment the LED turns off.

`delay()` is like putting rice on the stove and **staring at it for 30 minutes** – you can't do anything else.

## 2. The idea behind `millis()`

`millis()` returns the milliseconds since the board booted (a stopwatch that never stops). Instead of waiting, we **glance at the clock**:

```cpp
unsigned long lastBlinkTime = 0;

void loop() {
  unsigned long now = millis();
  if (now - lastBlinkTime >= 1000) {   // has 1 second passed since last time?
    lastBlinkTime = now;               // remember the new timestamp
    ledOn = !ledOn;
    digitalWrite(LED_PIN, ledOn);
  }
  // not yet → skip it and do other work right away
}
```

Like putting the rice on, **glancing at the clock now and then**, and cooking the soup and washing vegetables meanwhile.

## 3. Lesson code – 3 tasks in parallel

[main.cpp](main.cpp) is split into 3 "tasks", each with its own timestamp:

| Task | Function | Period |
|------|----------|--------|
| Blink the LED | `updateLed()` | 1000 / 300 / 80 ms, or off |
| Read button + debounce | `updateButton()` | every `loop()` |
| Print status | `updateReport()` | 5000 ms |

```cpp
void loop() {
  unsigned long now = millis();
  updateLed(now);
  updateButton(now);
  updateReport(now);
}
```

Each function only asks "is it time yet?" and returns → `loop()` spins **hundreds of thousands of times a second** and never misses a press. Press BOOT to change mode: `SLOW → MEDIUM → FAST → OFF → SLOW…`

## 4. Upload
- Main lesson: pick **`env:lesson03`** → **→ Upload** → **🔌 Serial Monitor**
- `delay()` demo: pick **`env:lesson03_blocking`**

```bash
~/.platformio/penv/bin/pio run -e lesson03 -t upload -t monitor
~/.platformio/penv/bin/pio run -e lesson03_blocking -t upload -t monitor
```

## 5. Expected result
```
=== Lesson 03 - millis() ===
Press BOOT to change blink speed
[  2140 ms] Mode: MEDIUM
[  3518 ms] Mode: FAST
[  5000 ms] Still running, mode FAST
[  6210 ms] Mode: OFF
[ 10000 ms] Still running, mode OFF
```
The LED changes speed **instantly** when you press, and the "Still running" line still appears every 5 seconds.

## ⚠️ Important

**Always use `unsigned long` and write it as a subtraction:**
```cpp
if (now - lastTime >= interval)   // ✅ correct
if (now >= lastTime + interval)   // ❌ breaks after ~49.7 days
```
`millis()` is a 32-bit number that wraps back to 0 after ~49.7 days (overflow). Unsigned subtraction still gives the right answer across the wrap; addition doesn't.

**A short `delay()` in `setup()` is fine** – just avoid it in `loop()` when you need to do several things.

## 6. Exercises
1. Add a 4th task: print `"Tick"` every 2 seconds (just one more timestamp variable + one function).
2. Add an **SOS** mode to the list – hint: use an array of durations `{200,200,200,200,200,600, 600,200,...}` and a step index, no `delay()`.
3. Hold BOOT ≥ 1 second → go back to `SLOW` mode (combine with lesson 02).
4. **Measure `loop()` speed**: count `loop()` iterations per second and print them. Compare with `blocking-demo` (only ~0.5 per second!).
5. (Game) **Reaction timer**: after a random 2–5 s (`random(2000, 5000)`) the LED lights up; press BOOT as fast as you can and print your reaction time (ms). Pressing before the LED lights = foul.

## Key takeaways
- `delay()` = stand and wait, do nothing else. `millis()` = glance at the clock.
- Standard pattern: `if (now - last >= interval) { last = now; ... }`
- One timestamp variable per task → adding a task doesn't affect the others.
- Use `unsigned long` for time.

➡️ Next lesson: **04 – Capacitive touch**: turn a wire into a button.
