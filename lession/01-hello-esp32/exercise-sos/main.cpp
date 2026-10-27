// Lesson 01 – Exercise 2: blink SOS in Morse code ( ... --- ... )
#include <Arduino.h>

const int LED_PIN = 2;

// Morse timing: every gap is a multiple of one "unit"
const int UNIT = 200;               // ms
const int DOT = UNIT;               // dot (short)  = 1 unit
const int DASH = 3 * UNIT;          // dash (long)  = 3 units
const int SYMBOL_GAP = UNIT;        // gap between symbols in a letter
const int LETTER_GAP = 3 * UNIT;    // gap between letters

// Gap between SOS repeats: Morse says 7 units, but a longer pause makes the start easy to see,
// otherwise the last S and the next first S look like 6 short blinks in a row
const int REPEAT_GAP = 2000;

// LED on for `duration` ms, then off for SYMBOL_GAP
void blink(int duration) {
  Serial.print(duration == DOT ? '.' : '-');
  digitalWrite(LED_PIN, HIGH);
  delay(duration);
  digitalWrite(LED_PIN, LOW);
  delay(SYMBOL_GAP);
}

// Blink one letter made of `count` identical symbols (S = 3 dots, O = 3 dashes)
void letter(char name, int count, int duration) {
  Serial.printf("%c ", name);
  for (int i = 0; i < count; i++) {
    blink(duration);
  }
  Serial.print("  ");
  delay(LETTER_GAP - SYMBOL_GAP);  // SYMBOL_GAP already elapsed after the last symbol
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  letter('S', 3, DOT);
  letter('O', 3, DASH);
  letter('S', 3, DOT);
  Serial.println();

  delay(2000);  // LETTER_GAP already elapsed after the last letter
}
