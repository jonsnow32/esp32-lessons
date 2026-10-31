// Copy to secrets.h (not committed) and fill in
#pragma once

#define WIFI_SSID "your-wifi"
#define WIFI_PASSWORD "your-wifi-password"

#define MQTT_HOST "192.168.1.10"  // the RK3318 server's IP
#define MQTT_PORT 1883
// Also the device id: the broker only lets it write under home/<MQTT_USER>/
#define MQTT_USER "esp32-den"
#define MQTT_PASSWORD "device-password"
