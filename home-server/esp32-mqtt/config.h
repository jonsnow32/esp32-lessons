// Pins, calibration, timing and MQTT topics: what you might change, in one place
#pragma once

#include "secrets.h"  // copy secrets.example.h to secrets.h and fill it in

constexpr int LED_PIN = 2;
constexpr int BUTTON_PIN = 0;  // BOOT button: toggles the LED by hand too
constexpr int SOIL_PIN = 34;   // soil sensor AOUT – must be ADC1 (GPIO32–39): ADC2 stops working with Wi-Fi on

// Calibration: read "raw" on Serial with the probe dry in air, then in a glass of water
constexpr int SOIL_DRY_RAW = 2800;  // raw value when dry  -> 0 %
constexpr int SOIL_WET_RAW = 1200;  // raw value in water  -> 100 %

// ESP32 Lab's emulator talks to a test broker on the computer running the lab (10.0.2.2 there),
// e.g. mosquitto, without a password – never to the home server. It also uses its own device id,
// MQTT_USER "-lab", so its topics and Home Assistant device never collide with the real board's
#define LAB_MQTT_HOST "10.0.2.2"

constexpr unsigned long RETRY_INTERVAL = 5000;    // try the broker again every 5 s
constexpr unsigned long DEBOUNCE_MS = 50;
constexpr unsigned long SENSOR_INTERVAL = 10000;  // soil moisture changes slowly: every 10 s is plenty

// Topics, all under home/<device id>/ (built at startup in ha_mqtt.cpp, since the id depends on
// whether we run on the real board or the emulator):
//   home/<id>/led/state      we publish ON/OFF (retained)
//   home/<id>/led/set        Home Assistant sends ON/OFF here
//   home/<id>/availability   online/offline (Last Will)
//   home/<id>/soil           {"moisture":..,"raw":..}
// Home Assistant MQTT discovery: homeassistant/<component>/<id>/<object>/config
constexpr const char *HA_STATUS_TOPIC = "homeassistant/status";
