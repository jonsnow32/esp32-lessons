// Home server demo – the onboard LED as an MQTT switch + a capacitive soil moisture sensor,
// both found by Home Assistant by itself.
//
//   config.h      pins, calibration, timing, MQTT topics (Wi-Fi and passwords in secrets.h)
//   led.*         the LED, its state kept in flash
//   button.*      BOOT button toggles the LED
//   soil.*        soil moisture readings
//   wifi_conn.*   Wi-Fi
//   ha_mqtt.*     MQTT + Home Assistant discovery (on ESP32 Lab's emulator: a test broker
//                 on the computer instead, so the real board and Home Assistant are left alone)
#include <Arduino.h>

#include "button.h"
#include "ha_mqtt.h"
#include "led.h"
#include "wifi_conn.h"
#include "soil.h"

void setup() {
  Serial.begin(115200);
  ledBegin();
  buttonBegin();
  soilBegin();
  wifiBegin();
  haBegin();
}

void loop() {
  unsigned long now = millis();
  haLoop(now);
  updateButton(now);
  updateSoil(now);
}
