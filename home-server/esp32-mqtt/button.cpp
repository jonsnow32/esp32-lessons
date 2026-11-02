#include "button.h"

#include <Arduino.h>

#include "config.h"
#include "led.h"

static int lastReading = HIGH;
static int stableState = HIGH;
static unsigned long lastChangeTime = 0;

void buttonBegin() { pinMode(BUTTON_PIN, INPUT_PULLUP); }

void updateButton(unsigned long now) {
  int reading = digitalRead(BUTTON_PIN);
  if (reading != lastReading) {
    lastChangeTime = now;
    lastReading = reading;
  }
  if (now - lastChangeTime >= DEBOUNCE_MS && reading != stableState) {
    stableState = reading;
    if (stableState == LOW) setLed(!ledIsOn());
  }
}
