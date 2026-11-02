#include "wifi_conn.h"

#include <Arduino.h>
#include <WiFi.h>

#include "config.h"

static bool radio = true;

bool wifiBegin() {
  // The emulator's chip always has MAC 24:0a:c4:12:34:56 (WiFi.mode() would stop it there)
  if (ESP.getEfuseMac() == 0x563412c40a24ULL) {
    radio = false;
    Serial.println("Emulator: no Wi-Fi here, the BOOT button and the soil sensor still work");
    return false;
  }
  WiFi.mode(WIFI_STA);
  // Modem sleep (the default) delays MQTT pings until the broker drops us ("exceeded timeout")
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);  // reconnects by itself if the router drops
  Serial.printf("Wi-Fi connecting to %s\n", WIFI_SSID);
  return true;
}

bool hasRadio() { return radio; }
