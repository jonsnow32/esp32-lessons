// Bài 01 – Hello ESP32: nháy LED onboard và in ra Serial Monitor
#include <Arduino.h>

// Hầu hết board ESP32 DevKit có LED xanh dương nối với GPIO2.
// Nếu board của bạn không nháy, thử đổi sang chân khác hoặc nối LED ngoài.
const int LED_PIN = 2;

// Tốc độ Serial – phải trùng với monitor_speed trong platformio.ini
const unsigned long BAUD_RATE = 115200;

int counter = 0;

void setup() {
  Serial.begin(BAUD_RATE);
  delay(1000);  // chờ Serial Monitor kết nối

  pinMode(LED_PIN, OUTPUT);

  Serial.println();
  Serial.println("=== Hello ESP32! ===");
  Serial.printf("Chip model   : %s (rev %d)\n", ESP.getChipModel(), ESP.getChipRevision());
  Serial.printf("So nhan CPU  : %d\n", ESP.getChipCores());
  Serial.printf("Xung CPU     : %lu MHz\n", ESP.getCpuFreqMHz());
  Serial.printf("Flash        : %lu MB\n", ESP.getFlashChipSize() / (1024 * 1024));
  Serial.printf("RAM trong    : %lu bytes\n", ESP.getFreeHeap());
  uint64_t mac = ESP.getEfuseMac();  // MAC lưu trong eFuse, byte thấp đứng trước
  Serial.printf("MAC address  : %02X:%02X:%02X:%02X:%02X:%02X\n",
                (uint8_t)(mac), (uint8_t)(mac >> 8), (uint8_t)(mac >> 16),
                (uint8_t)(mac >> 24), (uint8_t)(mac >> 32), (uint8_t)(mac >> 40));
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  Serial.printf("[%d] LED BAT\n", counter);
  delay(100);

  digitalWrite(LED_PIN, LOW);
  Serial.printf("[%d] LED TAT\n", counter);
  delay(2000);
  
  counter++;
}
