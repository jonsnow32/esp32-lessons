# Bài 01 – Hello ESP32: Nháy LED & Serial Monitor

## Mục tiêu
- Kết nối ESP32 với máy Mac và nhận diện được cổng nạp
- Hiểu cấu trúc chương trình Arduino: `setup()` và `loop()`
- Nạp code, nháy LED onboard
- Dùng Serial Monitor để xem thông tin chip

## Chuẩn bị
- Board ESP32-D (ESP32 Dev Module) cổng Type-C
- Cáp USB C-C **có truyền dữ liệu** (nhiều cáp chỉ sạc, không có dây data)
- VS Code + extension PlatformIO (đã có sẵn trong project này)

## 1. Làm quen board

```
            ┌─────────────────────┐
            │   ┌─────────────┐   │
            │   │  ESP32-WROOM │   │  ← module chính (CPU 2 nhân + WiFi + BT)
            │   │  (anten PCB) │   │
            │   └─────────────┘   │
   EN  ○    │                     │    ○ BOOT (GPIO0)
 (reset)    │   ● LED nguồn (đỏ)  │
            │   ● LED GPIO2 (xanh)│
            │   [chip USB-UART]   │  ← CH340 hoặc CP2102
            └────────[Type-C]─────┘
```

- **EN**: nút reset – khởi động lại chương trình
- **BOOT**: giữ nút này khi bật/reset để vào chế độ nạp code (thường tự động, không cần)
- **LED GPIO2**: LED mà ta sẽ điều khiển trong bài này
- **Chip USB-UART**: chuyển USB sang Serial để máy tính nói chuyện với ESP32

## 2. Kết nối với máy Mac

1. Cắm cáp vào board → LED nguồn đỏ phải sáng.
2. Mở Terminal, chạy:
   ```bash
   ls /dev/cu.*
   ```
   Phải thấy một cổng mới như `/dev/cu.usbserial-XXXX`, `/dev/cu.wchusbserial-XXXX` hoặc `/dev/cu.SLAB_USBtoUART`.

### Nếu không thấy cổng / LED đỏ không sáng
| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|------------|------------------------|------------|
| LED đỏ **không sáng** với cáp C-C | Nhiều board ESP32 Type-C giá rẻ thiếu điện trở CC 5.1kΩ nên sạc/cáp C-C không cấp nguồn | Dùng cáp **USB-A → Type-C** (qua hub/adapter USB-A) |
| LED sáng nhưng không có cổng | Cáp chỉ sạc, không có data | Đổi cáp khác |
| LED sáng nhưng không có cổng (cáp tốt) | Thiếu driver chip USB | Xem tên chip trên board: **CH340** → cài driver WCH CH34x; **CP2102** → cài driver Silicon Labs |

## 3. Hiểu code

Mở file [main.cpp](main.cpp):

```cpp
void setup() {   // chạy MỘT lần khi ESP32 khởi động / reset
  Serial.begin(115200);       // mở cổng Serial tốc độ 115200 baud
  pinMode(LED_PIN, OUTPUT);   // đặt GPIO2 là ngõ ra
}

void loop() {    // chạy LẶP LẠI mãi mãi
  digitalWrite(LED_PIN, HIGH);  // xuất 3.3V → LED sáng
  delay(500);                   // chờ 500ms
  digitalWrite(LED_PIN, LOW);   // xuất 0V → LED tắt
  delay(500);
}
```

`Serial.printf(...)` in chữ ra máy tính – công cụ debug quan trọng nhất bạn sẽ dùng mọi bài.

## 4. Nạp code

Project dùng **môi trường riêng cho từng bài** (khai báo trong `platformio.ini`). Bài này là `lesson01` và đã được đặt mặc định.

### Cách A – Dùng VS Code (khuyên dùng)
1. Thanh trạng thái phía dưới VS Code: bấm vào chỗ chọn môi trường, chọn `env:lesson01`.
2. Bấm biểu tượng **→ (Upload)** ở thanh dưới.
3. Bấm biểu tượng **🔌 (Serial Monitor)** để xem kết quả.

### Cách B – Dùng Terminal
```bash
~/.platformio/penv/bin/pio run -e lesson01 -t upload     # build + nạp
~/.platformio/penv/bin/pio device monitor                 # mở Serial Monitor (Ctrl+C để thoát)
```

### Nếu nạp lỗi `Failed to connect to ESP32: Wrong boot mode detected`
1. Bấm Upload.
2. Khi thấy dòng `Connecting.....`, **nhấn giữ nút BOOT** khoảng 1–2 giây rồi thả.

Nếu lỗi `Unable to verify flash chip connection` sau dòng `Changing baud rate...`: chip USB không chạy nổi tốc độ cao. Project đã đặt `upload_speed = 460800` (921600 bị lỗi trên board thử nghiệm); nếu vẫn lỗi hạ tiếp xuống `115200`.

## 5. Kết quả mong đợi
- LED xanh trên board nháy 1 lần/giây.
- Serial Monitor hiện (nhấn nút **EN** để xem lại từ đầu):
  ```
  === Hello ESP32! ===
  Chip model   : ESP32-D0WD-V3 (rev 3)
  So nhan CPU  : 2
  Xung CPU     : 240 MHz
  Flash        : 4 MB
  RAM trong    : ~300000 bytes
  MAC address  : XX:XX:XX:XX:XX:XX
  [0] LED BAT
  [0] LED TAT
  [1] LED BAT
  ...
  ```

> Nếu LED không nháy nhưng Serial vẫn in chữ: board của bạn có thể không có LED ở GPIO2. Không sao – bài 05 sẽ nối LED ngoài.

## 6. Bài tập
1. Đổi LED nháy nhanh hơn (100ms) rồi chậm hơn (2s).
2. Nháy theo mã SOS: 3 ngắn – 3 dài – 3 ngắn.
3. Chỉ in ra Serial mỗi khi `counter` chia hết cho 10.
4. Thử đổi `BAUD_RATE` thành 9600 nhưng **không** sửa `monitor_speed` → quan sát chữ lỗi. Giải thích vì sao.

## Kiến thức cần nhớ
- `setup()` chạy 1 lần, `loop()` chạy lặp vô hạn.
- ESP32 dùng mức logic **3.3V** (khác Arduino Uno 5V) – không cấp 5V trực tiếp vào chân GPIO.
- Tốc độ baud trong code và trong Serial Monitor phải giống nhau.

➡️ Bài tiếp theo: **02 – Nút bấm (Digital Input)** dùng chính nút BOOT trên board.
