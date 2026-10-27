# Lộ trình học ESP32 (ESP32-D / ESP32 Dev Module, cổng Type-C)

Mỗi bài nằm trong một thư mục riêng `lession/NN-ten-bai/` gồm:
- `README.md` – lý thuyết, sơ đồ nối dây, các bước làm, bài tập
- `main.cpp` – code mẫu

Mỗi bài có một môi trường riêng trong `platformio.ini` (`lesson01`, `lesson02`, ...).
Nạp bài nào thì chọn môi trường đó (xem hướng dẫn trong Bài 01).

## Giai đoạn 1 – Làm quen phần cứng (không cần linh kiện ngoài)

| # | Bài | Học được gì | Linh kiện |
|---|-----|-------------|-----------|
| 01 | Hello ESP32 – Blink & Serial | Cài đặt, nạp code, `setup()/loop()`, Serial Monitor, LED onboard | Chỉ board + cáp |
| 02 | Nút bấm (Digital Input) | `pinMode`, `digitalRead`, pull-up, chống dội phím (debounce) – dùng nút BOOT (GPIO0) | Chỉ board |
| 03 | Lập trình không chặn với `millis()` | Bỏ `delay()`, chạy nhiều việc cùng lúc, máy trạng thái đơn giản | Chỉ board |
| 04 | Cảm biến chạm điện dung (Touch) | `touchRead()`, ngưỡng, biến dây điện thành nút chạm | 1 sợi dây jumper |

## Giai đoạn 2 – Vào/ra cơ bản

| # | Bài | Học được gì | Linh kiện |
|---|-----|-------------|-----------|
| 05 | PWM – LED sáng dần | Bộ LEDC, tần số, độ phân giải, duty cycle | LED + điện trở 220Ω |
| 06 | ADC – Đọc biến trở | `analogRead`, 12-bit, suy hao (attenuation), ADC1 vs ADC2 | Biến trở 10k |
| 07 | Ngắt (Interrupt) & Timer phần cứng | `attachInterrupt`, `IRAM_ATTR`, `volatile`, hardware timer | Nút bấm |
| 08 | Pinout ESP32 – chân nào dùng được? | Chân strapping, chân chỉ-đọc 34–39, chân flash 6–11 | — (bài lý thuyết + bảng tra) |

## Giai đoạn 3 – Giao tiếp ngoại vi

| # | Bài | Học được gì | Linh kiện |
|---|-----|-------------|-----------|
| 09 | I2C – Màn hình OLED SSD1306 | `Wire`, quét địa chỉ I2C, thư viện Adafruit SSD1306 | OLED 0.96" |
| 10 | Cảm biến nhiệt độ/độ ẩm | DHT11/DHT22 hoặc BME280, thêm thư viện qua `lib_deps` | DHT22 hoặc BME280 |
| 11 | UART thứ 2 & SPI | `Serial2`, giao tiếp module khác, SPI cơ bản | Tuỳ chọn |

## Giai đoạn 4 – Kết nối không dây (thế mạnh của ESP32)

| # | Bài | Học được gì | Linh kiện |
|---|-----|-------------|-----------|
| 12 | WiFi Station + lấy giờ NTP | Kết nối WiFi, IP, RSSI, đồng bộ thời gian | Chỉ board |
| 13 | Web Server – bật/tắt LED qua trình duyệt | `WebServer`, HTML đơn giản, chế độ Access Point | Chỉ board |
| 14 | HTTP Client & JSON | Gọi API thời tiết, ArduinoJson | Chỉ board |
| 15 | MQTT | Broker, publish/subscribe, điều khiển từ điện thoại | Chỉ board |
| 16 | Bluetooth Low Energy (BLE) | Server/characteristic, điều khiển qua app nRF Connect | Điện thoại |

## Giai đoạn 5 – Nâng cao

| # | Bài | Học được gì | Linh kiện |
|---|-----|-------------|-----------|
| 17 | Lưu dữ liệu: Preferences (NVS) & LittleFS | Lưu cấu hình khi mất điện, file hệ thống | Chỉ board |
| 18 | Deep Sleep & tiết kiệm pin | Các chế độ ngủ, đánh thức bằng timer/touch/nút, RTC memory | Chỉ board |
| 19 | FreeRTOS & 2 nhân CPU | `xTaskCreatePinnedToCore`, queue, mutex | Chỉ board |
| 20 | OTA – nạp code qua WiFi | ArduinoOTA, nạp không cần cáp | Chỉ board |
| 21 | Dự án tổng hợp: Trạm thời tiết IoT | Kết hợp cảm biến + OLED + WiFi + Web/MQTT + Deep Sleep | Tổng hợp |

## Gợi ý mua linh kiện (cho từ Bài 05 trở đi)
- Breadboard + bộ dây jumper đực-đực
- Vài LED 5mm + điện trở 220Ω / 10kΩ
- Nút nhấn 4 chân, biến trở 10kΩ
- Màn hình OLED 0.96" I2C (SSD1306)
- Cảm biến DHT22 hoặc BME280

## Tiến độ
- [ ] 01 – Hello ESP32
- [ ] 02 – Nút bấm
- [ ] 03 – millis()
- [ ] 04 – Touch
- [ ] 05 – PWM
- [ ] 06 – ADC
- [ ] 07 – Ngắt & Timer
- [ ] 08 – Pinout
- [ ] 09 – I2C OLED
- [ ] 10 – Cảm biến nhiệt độ
- [ ] 11 – UART2 & SPI
- [ ] 12 – WiFi + NTP
- [ ] 13 – Web Server
- [ ] 14 – HTTP & JSON
- [ ] 15 – MQTT
- [ ] 16 – BLE
- [ ] 17 – NVS & LittleFS
- [ ] 18 – Deep Sleep
- [ ] 19 – FreeRTOS
- [ ] 20 – OTA
- [ ] 21 – Dự án tổng hợp
