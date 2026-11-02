#include "led.h"

#include <Arduino.h>
#include <Preferences.h>

#include "config.h"
#include "ha.h"

static Preferences prefs;  // keeps the LED state in flash so it survives a restart
static bool ledOn = false;

void ledBegin() {
  pinMode(LED_PIN, OUTPUT);
  prefs.begin("esp32-mqtt");
  ledOn = prefs.getBool("led", false);
  digitalWrite(LED_PIN, ledOn ? HIGH : LOW);
}

void applyLed(bool on) {
  if (on != ledOn) prefs.putBool("led", on);  // write flash only when it changes
  ledOn = on;
  digitalWrite(LED_PIN, on ? HIGH : LOW);
  Serial.printf("LED %s\n", on ? "ON" : "OFF");
}

void setLed(bool on) {
  applyLed(on);
  ha.setSwitch("led", on);
}

bool ledIsOn() { return ledOn; }
