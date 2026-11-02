// Wi-Fi, on the home router or on ESP32 Lab's virtual network (the emulator)
#pragma once

void wifiBegin();   // start Wi-Fi; it connects and reconnects by itself
bool onEmulator();  // running in ESP32 Lab's emulator, not on the real board
