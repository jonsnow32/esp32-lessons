// Home server demo – the onboard LED as an MQTT switch + a capacitive soil moisture sensor,
// both found by Home Assistant by itself.
//
//   config.h      pins, calibration, timing, MQTT topics (Wi-Fi and passwords in secrets.h)
//   led.*         the LED, its state kept in flash
//   button.*      BOOT button toggles the LED
//   soil.*        soil moisture readings
//   wifi_conn.*   Wi-Fi (none on ESP32 Lab's emulator)
//   ha_mqtt.*     MQTT + Home Assistant discovery
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
  if (!wifiBegin()) return;  // the emulator: LED, BOOT and soil sensor only
  haBegin();
}

void loop() {
  unsigned long now = millis();
  haLoop(now);
  updateButton(now);
  updateSoil(now);
}
