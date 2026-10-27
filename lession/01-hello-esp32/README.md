# Lesson 01 – Hello ESP32: Blink & Serial Monitor

## Goals
- Connect the ESP32 to your Mac and find its upload port
- Understand the structure of an Arduino program: `setup()` and `loop()`
- Upload code and blink the onboard LED
- Use the Serial Monitor to read chip information

## You need
- ESP32-D board (ESP32 Dev Module) with a Type-C port
- A USB C-C cable **that carries data** (many cables are charge-only)
- VS Code + the PlatformIO extension (already set up in this project)

## 1. Meet the board

```
            ┌──────────────────────┐
            │   ┌──────────────┐   │
            │   │ ESP32-WROOM  │   │  ← main module (dual-core CPU + WiFi + BT)
            │   │ (PCB antenna)│   │
            │   └──────────────┘   │
   EN  ○    │                      │    ○ BOOT (GPIO0)
 (reset)    │   ● Power LED (red)  │
            │   ● GPIO2 LED (blue) │
            │   [USB-UART chip]    │  ← CH340 or CP2102
            └────────[Type-C]──────┘
```

- **EN**: reset button – restarts the program
- **BOOT**: hold it while powering up/resetting to enter upload mode (usually automatic, not needed)
- **GPIO2 LED**: the LED we control in this lesson
- **USB-UART chip**: converts USB to Serial so the computer can talk to the ESP32

## 2. Connect to your Mac

1. Plug the cable into the board → the red power LED must light up.
2. Open Terminal and run:
   ```bash
   ls /dev/cu.*
   ```
   You should see a new port such as `/dev/cu.usbserial-XXXX`, `/dev/cu.wchusbserial-XXXX` or `/dev/cu.SLAB_USBtoUART`.

### No port / red LED stays off
| Symptom | Common cause | Fix |
|---------|--------------|-----|
| Red LED **off** with a C-C cable | Many cheap ESP32 Type-C boards lack the 5.1kΩ CC resistors, so C-C chargers/cables don't power them | Use a **USB-A → Type-C** cable (via a USB-A hub/adapter) |
| LED on but no port | Charge-only cable | Try another cable |
| LED on but no port (good cable) | Missing USB chip driver | Check the chip name on the board: **CH340** → install the WCH CH34x driver; **CP2102** → install the Silicon Labs driver |

## 3. Understand the code

Open [main.cpp](main.cpp):

```cpp
void setup() {   // runs ONCE when the ESP32 boots / resets
  Serial.begin(115200);       // open Serial at 115200 baud
  pinMode(LED_PIN, OUTPUT);   // make GPIO2 an output
}

void loop() {    // runs AGAIN and AGAIN forever
  digitalWrite(LED_PIN, HIGH);  // output 3.3V → LED on
  delay(500);                   // wait 500ms
  digitalWrite(LED_PIN, LOW);   // output 0V → LED off
  delay(500);
}
```

`Serial.printf(...)` prints text to the computer – the most important debugging tool you'll use in every lesson.

## 4. Upload the code

The project uses **one environment per lesson** (declared in `platformio.ini`). This lesson is `lesson01`.

### Option A – VS Code (recommended)
1. In the VS Code status bar at the bottom, click the environment picker and choose `env:lesson01`.
2. Click the **→ (Upload)** icon in the bottom bar.
3. Click the **🔌 (Serial Monitor)** icon to see the output.

### Option B – Terminal
```bash
~/.platformio/penv/bin/pio run -e lesson01 -t upload     # build + upload
~/.platformio/penv/bin/pio device monitor                 # open Serial Monitor (Ctrl+C to quit)
```

### Upload fails with `Failed to connect to ESP32: Wrong boot mode detected`
1. Click Upload.
2. When you see `Connecting.....`, **hold the BOOT button** for 1–2 seconds, then release.

If it fails with `Unable to verify flash chip connection` after `Changing baud rate...`: the USB chip can't keep up with the high speed. The project uses `upload_speed = 460800` (921600 failed on the test board); if it still fails, drop to `115200`.

### Upload fails with `port is busy`
Another program has the port open – usually a Serial Monitor in another terminal. Close it with `Ctrl+C`, then upload again. `lsof | grep usbserial` shows who holds the port.

## 5. Expected result
- The blue LED on the board blinks.
- The Serial Monitor shows (press **EN** to see it from the start):
  ```
  === Hello ESP32! ===
  Chip model   : ESP32-D0WD-V3 (rev 3)
  CPU cores    : 2
  CPU clock    : 240 MHz
  Flash        : 4 MB
  Free RAM     : ~300000 bytes
  MAC address  : XX:XX:XX:XX:XX:XX
  [0] LED ON
  [0] LED OFF
  [1] LED ON
  ...
  ```

> If the LED doesn't blink but Serial prints text: your board may not have an LED on GPIO2. No problem – lesson 05 wires an external LED.

## 6. Exercises
1. Make the LED blink faster (100ms), then slower (2s).
2. Blink SOS in Morse code: 3 short – 3 long – 3 short. (Solution: [exercise-sos/main.cpp](exercise-sos/main.cpp), env `lesson01_sos`.)
3. Print to Serial only when `counter` is a multiple of 10.
4. Change `BAUD_RATE` to 9600 but **don't** change `monitor_speed` → look at the garbled text. Explain why.

## Key takeaways
- `setup()` runs once, `loop()` runs forever.
- The ESP32 uses **3.3V** logic (unlike the 5V Arduino Uno) – never feed 5V straight into a GPIO pin.
- The baud rate in code and in the Serial Monitor must match.
- Code is stored in flash: it keeps running after power loss until you upload something else.

➡️ Next lesson: **02 – Button (Digital Input)** using the board's own BOOT button.
