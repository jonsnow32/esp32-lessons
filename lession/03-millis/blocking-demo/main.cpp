// Lesson 03 – The WRONG way: delay() freezes the program and button presses get missed
#include <Arduino.h>

const int LED_PIN = 2;
const int BUTTON_PIN = 0;  // BOOT button

int pressCount = 0;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  Serial.println();
  Serial.println("=== Lesson 03 - delay() demo ===");
  Serial.println("Press BOOT 5 times fast - count how many get lost");
}

void loop() {
  // delay(): for these 2 s the ESP32 does nothing else
  digitalWrite(LED_PIN, HIGH);
  delay(1000);
  digitalWrite(LED_PIN, LOW);
  delay(1000);

  // Read once every 2 s → counts only if held right now
  if (digitalRead(BUTTON_PIN) == LOW) {
    pressCount++;
    Serial.printf("Press #%d\n", pressCount);
  }
}
