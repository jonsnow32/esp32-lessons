// Lesson 01 – Hello ESP32: blink the onboard LED and print to the Serial Monitor
#include <Arduino.h>

// Most ESP32 DevKit boards have a blue LED wired to GPIO2.
// If yours doesn't blink, try another pin or wire up an external LED.
const int LED_PIN = 2;
const int EXTERNAL_LED_PIN = 18;
// Serial speed – must match monitor_speed in platformio.ini
const unsigned long BAUD_RATE = 115200;

int counter = 0;

void setup() {
  Serial.begin(BAUD_RATE);
  delay(1000);  // wait for the Serial Monitor to connect

  pinMode(LED_PIN, OUTPUT);
pinMode(EXTERNAL_LED_PIN, OUTPUT);
  Serial.println();
  Serial.println("=== Hello ESP32! ===");
  Serial.printf("Chip model   : %s (rev %d)\n", ESP.getChipModel(), ESP.getChipRevision());
  Serial.printf("CPU cores    : %d\n", ESP.getChipCores());
  Serial.printf("CPU clock    : %lu MHz\n", ESP.getCpuFreqMHz());
  Serial.printf("Flash        : %lu MB\n", ESP.getFlashChipSize() / (1024 * 1024));
  Serial.printf("Free RAM     : %lu bytes\n", ESP.getFreeHeap());
  uint64_t mac = ESP.getEfuseMac();  // MAC lives in eFuse, low byte first
  Serial.printf("MAC address  : %02X:%02X:%02X:%02X:%02X:%02X\n",
                (uint8_t)(mac), (uint8_t)(mac >> 8), (uint8_t)(mac >> 16),
                (uint8_t)(mac >> 24), (uint8_t)(mac >> 32), (uint8_t)(mac >> 40));
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  Serial.printf("[%d] LED ON\n", counter);
  delay(100);

  digitalWrite(LED_PIN, LOW);
  Serial.printf("[%d] LED OFF\n", counter);
  delay(500);
  
  digitalWrite(EXTERNAL_LED_PIN, HIGH);
  Serial.printf("[%d] LED ON\n", counter);
  delay(100);

  digitalWrite(EXTERNAL_LED_PIN, LOW);
  Serial.printf("[%d] LED OFF\n", counter);
  delay(500);
  
  counter++;
}
