# Lesson 02 – Button (Digital Input)

## Goals
- Read a button with `digitalRead()`
- Understand pull-up resistors and why a pressed button reads `LOW`
- Detect the **moment of pressing** (a state change) instead of "being held"
- Debounce a button

## You need
Just the board: we use the built-in **BOOT** button (wired to **GPIO0**). No extra parts.

## 1. How does a button work?

```
        3.3V
         │
        [R] ← pull-up resistor
         │
GPIO0 ───┤
         │
       ─┴─  BOOT button
       ─┬─
         │
        GND
```

- **Released**: GPIO0 is pulled up to 3.3V through the resistor → reads `HIGH`.
- **Pressed**: GPIO0 is connected straight to GND → reads `LOW`.

**Without** a pull-up the pin is "floating" and reads random values. The ESP32 has internal pull-ups, enabled with:

```cpp
pinMode(BUTTON_PIN, INPUT_PULLUP);
```

> A "pressed = LOW" button is called **active-low** – very common in electronics.

## 2. Step by step, from simple to correct

### Step 1 – Raw reading
```cpp
void loop() {
  Serial.println(digitalRead(BUTTON_PIN));  // 1 = released, 0 = pressed
  delay(100);
}
```

### Step 2 – LED on while held
```cpp
void loop() {
  bool pressed = digitalRead(BUTTON_PIN) == LOW;
  digitalWrite(LED_PIN, pressed ? HIGH : LOW);
}
```

### Step 3 – Press once to toggle the LED
For "press to turn on, press again to turn off" you must catch the **moment** the button goes from `HIGH` to `LOW`, not "is LOW". If you only check "is LOW", `loop()` runs hundreds of thousands of times a second and the LED flips constantly while you hold the button.

→ Remember the previous state and act only when `previous == HIGH && now == LOW`.

### Step 4 – Debouncing
A mechanical button doesn't close cleanly – it **bounces** for a few milliseconds:

```
Released ‾‾‾‾‾‾╗ ╔╗ ╔═╗
               ╚═╝╚═╝ ╚══════════  Pressed
               ←~5ms→
```

The ESP32 is fast enough to see every bounce → one press gets counted 2–3 times. The fix: **trust the signal only after it has been still for ≥ 50ms**. That's the code in [main.cpp](main.cpp):

```cpp
if (reading != lastReading) {          // signal changed → restart the wait
  lastChangeTime = millis();
  lastReading = reading;
}
if (millis() - lastChangeTime >= DEBOUNCE_MS &&
    reading != stableState) {
  stableState = reading;               // settled → accept it
  if (stableState == LOW) { /* handle one press */ }
}
```

`millis()` returns the milliseconds since the board booted – lesson 03 covers it in depth.

## 3. Upload
1. Pick **`env:lesson02`** in the VS Code status bar.
2. Click **→ Upload**, then open the **🔌 Serial Monitor**.

Or from Terminal:
```bash
~/.platformio/penv/bin/pio run -e lesson02 -t upload -t monitor
```

## 4. Expected result
Each BOOT press toggles the blue LED and Serial prints:
```
=== Lesson 02 - Button ===
Press BOOT to toggle the LED
Press #1 -> LED ON
Press #2 -> LED OFF
Press #3 -> LED ON
```

## ⚠️ About GPIO0
GPIO0 is a **strapping pin**: the ESP32 reads it at boot to decide whether to run your program or enter upload mode.
- **Don't hold BOOT while pressing EN / powering up** – the board will enter upload mode and won't run your code.
- Using GPIO0 as a button after boot is perfectly safe.
- For external buttons later, prefer regular pins like GPIO 4, 5, 13, 14, 25–27, 32, 33.

## 5. Exercises
1. Set `DEBOUNCE_MS = 0`, upload, and press 10 times. Does `pressCount` reach exactly 10? (Some boards bounce little, some a lot – try light/quick taps.)
2. Also print `"Released"` when the button is let go.
3. **Hold time**: print how long (ms) the button was held each time it's released. Hint: store `millis()` at the press.
4. **Hold ≥ 1 second** to reset `pressCount` to 0 and turn the LED off; short presses still toggle.
5. (Hard) **Double click** (2 presses within 400ms) blinks the LED 3 times.

## Real-world uses
- Smart light switch, doorbell button, people/product counter, mode menu, "hold 5 s to factory reset".
- Many sensors behave exactly like a button: reed switch (door open), PIR (motion), limit switch, rain sensor (DO pin), tilt/vibration switch. Swap the BOOT button for one of these and the code barely changes.

## Key takeaways
- `INPUT_PULLUP` → released = `HIGH`, pressed = `LOW`.
- React to **change events** (edges), not to the held state.
- Mechanical buttons always bounce – debounce with a settle time.
- GPIO0 is a strapping pin: don't hold BOOT during boot.

➡️ Next lesson: **03 – Non-blocking code with `millis()`**: blink an LED and read a button at the same time.
