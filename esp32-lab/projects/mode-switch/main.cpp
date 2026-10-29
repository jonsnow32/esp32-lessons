// Mode switch: the slide switch ties D4 to GND (slow blink) or 3.3 V (fast blink).
#include <Arduino.h>

const int SWITCH_PIN = 4;
const int LED_PIN = 23;

int lastMode = -1;
bool ledOn = false;
unsigned long lastToggle = 0;

void setup() {
  Serial.begin(115200);
  pinMode(SWITCH_PIN, INPUT);  // the switch always connects D4 to one side: no pull needed
  pinMode(LED_PIN, OUTPUT);
  Serial.println("=== Cong tac chon che do ===");
}

void loop() {
  int fast = digitalRead(SWITCH_PIN) == HIGH;
  unsigned long interval = fast ? 100 : 500;
  if (fast != lastMode) {
    lastMode = fast;
    Serial.printf("Che do: %s (%lu ms)\n", fast ? "NHANH" : "CHAM", interval);
  }
  if (millis() - lastToggle >= interval) {
    lastToggle = millis();
    ledOn = !ledOn;
    digitalWrite(LED_PIN, ledOn ? HIGH : LOW);
  }
}
