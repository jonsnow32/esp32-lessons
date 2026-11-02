// Home server demo – the onboard LED as an MQTT switch + a capacitive soil moisture sensor,
// both found by Home Assistant by itself.
//
//   config.h   pins, calibration, timing (Wi-Fi and passwords in secrets.h)
//   led.*      the LED, its state kept in flash
//   button.*   BOOT button toggles the LED
//   soil.*     soil moisture readings
//   ha.h       Wi-Fi, MQTT and Home Assistant discovery: lib/LabHA with this board's own account.
//              On ESP32 Lab's emulator it is esp32-den-lab and talks to a test broker on the
//              computer instead, so the real board and Home Assistant are left alone
//
// Topics (MQTT_USER is the device id, the broker's ACL keeps it under home/<id>/):
//   home/<id>/led/state        ON/OFF (retained)
//   home/<id>/led/set          Home Assistant sends ON/OFF here
//   home/<id>/moisture/state   soil moisture, %
//   home/<id>/availability     online/offline (Last Will)
#include <Arduino.h>

#include "button.h"
#include "config.h"
#include "ha.h"
#include "led.h"
#include "soil.h"

LabHA ha(LabHA::Account{WIFI_SSID, WIFI_PASSWORD, MQTT_HOST, MQTT_PORT, MQTT_USER, MQTT_PASSWORD});

void setup() {
  Serial.begin(115200);
  ledBegin();
  buttonBegin();
  soilBegin();

  // Keys and labels as before: Home Assistant keeps switch.esp32_den_led and the moisture sensor
  ha.addSwitch("led", "LED", applyLed);
  ha.setSwitch("led", ledIsOn());  // the state from flash, reported once MQTT connects
  ha.addSensor("moisture", "Độ ẩm đất", "%", "moisture");
  ha.begin();
}

void loop() {
  unsigned long now = millis();
  ha.loop();
  updateButton(now);
  updateSoil(now);
}
