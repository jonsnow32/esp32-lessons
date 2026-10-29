// Vòng 12 LED WS2812B: cầu vồng xoay, biến trở trên GPIO34 chỉnh độ sáng.
#include <Adafruit_NeoPixel.h>

const int LED_PIN = 5;
const int LED_COUNT = 12;
const int POT_PIN = 34;

// NEO_GRB: thứ tự màu của WS2812B; NEO_KHZ800: tốc độ 800 kHz
Adafruit_NeoPixel ring(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

uint16_t hue = 0;
int lastLevel = -100;

void setup() {
  Serial.begin(115200);
  ring.begin();
  ring.show();  // tắt hết LED
  Serial.println("Vong LED cau vong");
}

void loop() {
  int level = map(analogRead(POT_PIN), 0, 4095, 5, 255);
  ring.setBrightness(level);
  for (int i = 0; i < LED_COUNT; i++) {
    // Mỗi LED lệch màu một chút, cả vòng là một vòng màu
    uint16_t h = hue + i * 65536L / LED_COUNT;
    ring.setPixelColor(i, ring.gamma32(ring.ColorHSV(h)));
  }
  ring.show();  // gửi 12 × 24 bit qua RMT, rồi màu mới hiện cùng lúc

  if (abs(level - lastLevel) > 4) {
    Serial.printf("Do sang: %d/255\n", level);
    lastLevel = level;
  }
  hue += 1024;
  delay(20);
}
