# ESP32 Learning Roadmap (ESP32-D / ESP32 Dev Module, Type-C)

Each lesson lives in its own folder `lession/NN-name/` containing:
- `README.md` – theory, wiring, steps, exercises
- `main.cpp` – example code
- `VIDEO.md` – shot list for a YouTube Short

Each lesson has its own environment in `platformio.ini` (`lesson01`, `lesson02`, ...).
Pick the environment of the lesson you want to upload (see Lesson 01).

No board at hand? The virtual workbench in [`esp32-lab/`](../esp32-lab/README.md) is being built to run these same lessons in the browser.

## Stage 1 – Getting to know the hardware (no extra parts)

| # | Lesson | What you learn | Parts |
|---|--------|----------------|-------|
| [00](00-platformio/README.md) | PlatformIO basics | Installing PlatformIO, new project, choosing the board, Build/Upload/Monitor buttons | Board + cable |
| [01](01-hello-esp32/README.md) | Hello ESP32 – Blink & Serial | Setup, uploading, `setup()/loop()`, Serial Monitor, onboard LED | Board + cable |
| [02](02-button/README.md) | Button (Digital Input) | `pinMode`, `digitalRead`, pull-up, debouncing – using the BOOT button (GPIO0) | Board only |
| [03](03-millis/README.md) | Non-blocking code with `millis()` | Dropping `delay()`, running several tasks at once, simple state machine | Board only |
| 04 | Capacitive touch | `touchRead()`, thresholds, turning a wire into a touch button | 1 jumper wire |

## Stage 2 – Basic I/O

| # | Lesson | What you learn | Parts |
|---|--------|----------------|-------|
| 05 | PWM – fading LED | LEDC peripheral, frequency, resolution, duty cycle | LED + 220Ω resistor |
| 06 | ADC – reading a potentiometer | `analogRead`, 12-bit, attenuation, ADC1 vs ADC2 | 10k potentiometer |
| 07 | Interrupts & hardware timers | `attachInterrupt`, `IRAM_ATTR`, `volatile`, hardware timer | Push button |
| 08 | ESP32 pinout – which pins are safe? | Strapping pins, input-only pins 34–39, flash pins 6–11 | — (theory + reference table) |

## Stage 3 – Peripherals

| # | Lesson | What you learn | Parts |
|---|--------|----------------|-------|
| 09 | I2C – SSD1306 OLED display | `Wire`, I2C address scan, Adafruit SSD1306 library | 0.96" OLED |
| 10 | Temperature/humidity sensor | DHT11/DHT22 or BME280, adding libraries via `lib_deps` | DHT22 or BME280 |
| 11 | Second UART & SPI | `Serial2`, talking to other modules, SPI basics | Optional |

## Stage 4 – Wireless (ESP32's strength)

| # | Lesson | What you learn | Parts |
|---|--------|----------------|-------|
| 12 | WiFi Station + NTP time | Connecting to WiFi, IP, RSSI, time sync | Board only |
| 13 | Web server – toggle LED from a browser | `WebServer`, simple HTML, Access Point mode | Board only |
| 14 | HTTP client & JSON | Calling a weather API, ArduinoJson | Board only |
| 15 | MQTT | Broker, publish/subscribe, control from your phone | Board only |
| 16 | Bluetooth Low Energy (BLE) | Server/characteristic, control via nRF Connect app | Phone |

## Stage 5 – Advanced

| # | Lesson | What you learn | Parts |
|---|--------|----------------|-------|
| 17 | Storage: Preferences (NVS) & LittleFS | Keeping settings across power loss, file system | Board only |
| 18 | Deep sleep & power saving | Sleep modes, wake by timer/touch/button, RTC memory | Board only |
| 19 | FreeRTOS & dual core | `xTaskCreatePinnedToCore`, queues, mutexes | Board only |
| 20 | OTA – upload over WiFi | ArduinoOTA, cable-free uploads | Board only |
| 21 | Capstone: IoT weather station | Sensors + OLED + WiFi + Web/MQTT + deep sleep | Everything |

## Suggested parts (from Lesson 05 on)
- Breadboard + male-male jumper wires
- A few 5mm LEDs + 220Ω / 10kΩ resistors
- 4-pin push buttons, 10kΩ potentiometer
- 0.96" I2C OLED display (SSD1306)
- DHT22 or BME280 sensor

## Progress
- [x] 01 – Hello ESP32
- [x] 02 – Button
- [ ] 03 – millis()
- [ ] 04 – Touch
- [ ] 05 – PWM
- [ ] 06 – ADC
- [ ] 07 – Interrupts & timers
- [ ] 08 – Pinout
- [ ] 09 – I2C OLED
- [ ] 10 – Temperature sensor
- [ ] 11 – UART2 & SPI
- [ ] 12 – WiFi + NTP
- [ ] 13 – Web server
- [ ] 14 – HTTP & JSON
- [ ] 15 – MQTT
- [ ] 16 – BLE
- [ ] 17 – NVS & LittleFS
- [ ] 18 – Deep sleep
- [ ] 19 – FreeRTOS
- [ ] 20 – OTA
- [ ] 21 – Capstone project
