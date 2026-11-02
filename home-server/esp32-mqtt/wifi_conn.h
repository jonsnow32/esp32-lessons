// Wi-Fi, or none on ESP32 Lab's emulator (it has no radio)
#pragma once

bool wifiBegin();  // start Wi-Fi; false on the emulator
bool hasRadio();      // false on the emulator: only the LED, BOOT and soil sensor run there
