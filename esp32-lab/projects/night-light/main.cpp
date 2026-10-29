// Night light: 3.3 V -> LDR -> D4 -> 10 kOhm -> GND. In the light the LDR is a few kOhm and D4
// reads HIGH; in the dark it is hundreds of kOhm and D4 reads LOW, so the LED turns on.
#include <Arduino.h>

const int SENSOR_PIN = 4;
const int LED_PIN = 22;

int wasDark = -1;  // unknown at start, so the first reading is printed

void setup() {
  Serial.begin(115200);
  pinMode(SENSOR_PIN, INPUT);  // no pull-up: the divider sets the level
  pinMode(LED_PIN, OUTPUT);
  Serial.println("=== Den ngu tu dong ===");
}

void loop() {
  int dark = digitalRead(SENSOR_PIN) == LOW;
  if (dark != wasDark) {
    wasDark = dark;
    digitalWrite(LED_PIN, dark ? HIGH : LOW);
    Serial.println(dark ? "Troi toi -> bat den" : "Troi sang -> tat den");
  }
  delay(50);
}
