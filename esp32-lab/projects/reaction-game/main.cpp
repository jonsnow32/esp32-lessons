// Reaction game: press to start, wait for the LED, then press as fast as you can.
// Pressing before the LED lights loses the round.
#include <Arduino.h>

const int BUTTON_PIN = 4;  // other side of the button goes to GND
const int LED_PIN = 22;
const unsigned long DEBOUNCE_MS = 20;

enum State { IDLE, WAITING, LIT };
State state = IDLE;
unsigned long waitStart = 0;
unsigned long waitMs = 0;
unsigned long litAt = 0;
unsigned long best = 0;

bool lastReading = false;
bool pressed = false;
unsigned long lastFlip = 0;
uint32_t seed = 1;

// Small pseudo-random generator, seeded by when the player presses the button
uint32_t nextRandom() {
  seed = seed * 1664525u + 1013904223u;
  return seed >> 8;
}

void onPress() {
  if (state == IDLE) {
    seed ^= micros();
    waitMs = 1500 + nextRandom() % 2500;
    waitStart = millis();
    state = WAITING;
    Serial.println("San sang... doi den sang roi nhan!");
  } else if (state == WAITING) {
    state = IDLE;
    Serial.println("Som qua! Nhan nut de choi lai.");
  } else {
    unsigned long ms = millis() - litAt;
    digitalWrite(LED_PIN, LOW);
    state = IDLE;
    if (best == 0 || ms < best) best = ms;
    Serial.printf("Phan xa: %lu ms (ky luc: %lu ms). Nhan nut de choi tiep.\n", ms, best);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("=== Tro choi phan xa: nhan nut de bat dau ===");
}

void loop() {
  bool reading = digitalRead(BUTTON_PIN) == LOW;
  if (reading != lastReading) {
    lastReading = reading;
    lastFlip = millis();
  }
  if (millis() - lastFlip >= DEBOUNCE_MS && reading != pressed) {
    pressed = reading;
    if (pressed) onPress();
  }

  if (state == WAITING && millis() - waitStart >= waitMs) {
    state = LIT;
    litAt = millis();
    digitalWrite(LED_PIN, HIGH);
  }
}
