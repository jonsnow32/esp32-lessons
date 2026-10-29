// 7-segment counter: one GPIO per segment (a..g), each through 220 Ohm, common cathode to GND.
// The number goes up once a second, 0 -> 9 and round again; the button starts over from 0.
#include <Arduino.h>

const bool COMMON_ANODE = false;  // true: common pin on 3V3, a segment lights on LOW
const int SEGMENT_PINS[7] = {23, 22, 21, 19, 18, 16, 17};  // a b c d e f g
const int BUTTON_PIN = 4;

// Which segments each digit lights: bit 0 = a ... bit 6 = g
const byte DIGITS[10] = {
  0b0111111,  // 0: a b c d e f
  0b0000110,  // 1: b c
  0b1011011,  // 2: a b d e g
  0b1001111,  // 3: a b c d g
  0b1100110,  // 4: b c f g
  0b1101101,  // 5: a c d f g
  0b1111101,  // 6: a c d e f g
  0b0000111,  // 7: a b c
  0b1111111,  // 8: all
  0b1101111,  // 9: a b c d f g
};

int count = 0;
unsigned long lastStep = 0;
int lastButton = HIGH;
unsigned long lastChange = 0;

void show(int digit) {
  for (int s = 0; s < 7; s++) {
    bool on = DIGITS[digit] & (1 << s);
    digitalWrite(SEGMENT_PINS[s], on != COMMON_ANODE ? HIGH : LOW);
  }
}

void setup() {
  Serial.begin(115200);
  for (int s = 0; s < 7; s++) pinMode(SEGMENT_PINS[s], OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  show(count);
  Serial.println("=== Dem so 0-9 ===");
}

void loop() {
  unsigned long now = millis();

  // Button: act on a press that has stayed LOW for 30 ms (contacts bounce)
  int b = digitalRead(BUTTON_PIN);
  if (b != lastButton) {
    lastButton = b;
    lastChange = now;
  } else if (b == LOW && lastChange != 0 && now - lastChange > 30) {
    lastChange = 0;
    count = 0;
    lastStep = now;
    show(count);
    Serial.println("Dem lai tu 0");
  }

  if (now - lastStep >= 1000) {
    lastStep = now;
    count = (count + 1) % 10;
    show(count);
    Serial.print("So: ");
    Serial.println(count);
  }
}
