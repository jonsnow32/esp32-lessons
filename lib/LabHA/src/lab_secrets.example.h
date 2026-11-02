// Copy to lab_secrets.h in this folder (not committed) and fill in, once for every lab board
#pragma once

#define LAB_WIFI_SSID "your-wifi"
#define LAB_WIFI_PASSWORD "your-wifi-password"

#define LAB_MQTT_HOST "192.168.1.10"  // the RK3318 server's IP
#define LAB_MQTT_PORT 1883
// One broker account shared by every lab board. The box's ACL lets user "lab" write under
// home/lab/# and homeassistant/+/lab/#, so lab boards can never touch esp32-den or other devices.
// Create it once on the box:
//   docker compose exec mosquitto mosquitto_passwd /mosquitto/config/passwd lab
//   docker compose restart mosquitto
#define LAB_MQTT_USER "lab"
#define LAB_MQTT_PASSWORD "lab-password"
