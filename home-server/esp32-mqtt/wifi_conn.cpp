#include "wifi_conn.h"

#include <Arduino.h>
#include <WiFi.h>

#include "config.h"

bool onEmulator() {
  // The emulator's chip always has MAC 24:0a:c4:12:34:56
  return ESP.getEfuseMac() == 0x563412c40a24ULL;
}

void wifiBegin() {
  WiFi.mode(WIFI_STA);
  // Modem sleep (the default) delays MQTT pings until the broker drops us ("exceeded timeout")
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  // The emulator's virtual access point takes any SSID and password
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);  // reconnects by itself if the router drops
  Serial.printf("Wi-Fi connecting to %s%s\n", WIFI_SSID, onEmulator() ? " (ESP32 Lab, virtual)" : "");
}
