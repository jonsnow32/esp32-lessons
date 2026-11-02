// Pins, calibration and timing: what you might change, in one place
#pragma once

#include "secrets.h"  // copy secrets.example.h to secrets.h and fill it in

constexpr int LED_PIN = 2;
constexpr int BUTTON_PIN = 0;  // BOOT button: toggles the LED by hand too
constexpr int SOIL_PIN = 34;   // soil sensor AOUT – must be ADC1 (GPIO32–39): ADC2 stops working with Wi-Fi on

// Calibration: read "raw" on Serial with the probe dry in air, then in a glass of water
constexpr int SOIL_DRY_RAW = 2800;  // raw value when dry  -> 0 %
constexpr int SOIL_WET_RAW = 1200;  // raw value in water  -> 100 %

constexpr unsigned long DEBOUNCE_MS = 50;
constexpr unsigned long SENSOR_INTERVAL = 10000;  // soil moisture changes slowly: every 10 s is plenty
