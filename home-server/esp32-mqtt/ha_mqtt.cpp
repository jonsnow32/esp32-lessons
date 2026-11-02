#include "ha_mqtt.h"

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFi.h>

#include "config.h"
#include "led.h"
#include "wifi_conn.h"

static WiFiClient wifi;
static PubSubClient mqtt(wifi);
static unsigned long lastRetryTime = 0;

// The device id: MQTT_USER on the real board, MQTT_USER "-lab" on ESP32 Lab's emulator, so the
// emulator gets its own topics and its own device in Home Assistant
static const char *deviceId = MQTT_USER;
static char stateTopic[64], setTopic[64], availTopic[64], soilTopic[64];

// One HA sensor reading a field out of the soil JSON
static void sendSensorDiscovery(const char *key, const char *name, const char *deviceClass, const char *unit) {
  char topic[96];
  snprintf(topic, sizeof(topic), "homeassistant/sensor/%s/%s/config", deviceId, key);
  char config[512];
  snprintf(config, sizeof(config),
           "{\"name\":\"%s\",\"unique_id\":\"%s-%s\",\"device_class\":\"%s\","
           "\"unit_of_measurement\":\"%s\",\"state_class\":\"measurement\","
           "\"state_topic\":\"%s\",\"value_template\":\"{{ value_json.%s }}\","
           "\"availability_topic\":\"%s\",\"device\":{\"identifiers\":[\"%s\"]}}",
           name, deviceId, key, deviceClass, unit, soilTopic, key, availTopic, deviceId);
  mqtt.publish(topic, config, true);
}

// An empty retained config removes an old sensor from Home Assistant
static void removeSensorDiscovery(const char *key) {
  char topic[96];
  snprintf(topic, sizeof(topic), "homeassistant/sensor/%s/%s/config", deviceId, key);
  mqtt.publish(topic, "", true);
}

static void sendDiscovery() {
  char topic[96];
  snprintf(topic, sizeof(topic), "homeassistant/switch/%s/led/config", deviceId);
  char config[512];
  snprintf(config, sizeof(config),
           "{\"name\":\"LED\",\"unique_id\":\"%s-led\","
           "\"command_topic\":\"%s\",\"state_topic\":\"%s\",\"availability_topic\":\"%s\","
           "\"device\":{\"identifiers\":[\"%s\"],\"name\":\"%s\",\"model\":\"%s\"}}",
           deviceId, setTopic, stateTopic, availTopic, deviceId, deviceId,
           onEmulator() ? "ESP32 Lab emulator" : "ESP32 Dev Module");
  mqtt.publish(topic, config, true);
  sendSensorDiscovery("moisture", "Độ ẩm đất", "moisture", "%");
  // The DHT22 is gone: clear its two sensors from Home Assistant
  removeSensorDiscovery("temperature");
  removeSensorDiscovery("humidity");
}

static void onMessage(char *topic, byte *payload, unsigned int length) {
  String message((const char *)payload, length);
  if (strcmp(topic, setTopic) == 0) {
    if (message == "ON") setLed(true);
    else if (message == "OFF") setLed(false);
  } else if (strcmp(topic, HA_STATUS_TOPIC) == 0 && message == "online") {
    sendDiscovery();  // Home Assistant restarted
  }
}

static void connectMqtt(unsigned long now) {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  // Not time yet? Return right away – never block the loop
  if (now - lastRetryTime < RETRY_INTERVAL && lastRetryTime != 0) return;
  lastRetryTime = now;

  Serial.print("MQTT connecting... ");
  // Last Will: if we vanish (power cut, Wi-Fi lost) the broker publishes "offline" for us
  // The device id is also the client id; on the emulator the test broker needs no password
  bool lab = onEmulator();
  if (mqtt.connect(deviceId, lab ? nullptr : MQTT_USER, lab ? nullptr : MQTT_PASSWORD, availTopic, 1, true,
                   "offline")) {
    // Below about -75 dBm the link drops often: move the board or the router closer
    Serial.printf("ok (Wi-Fi %d dBm)\n", WiFi.RSSI());
    mqtt.publish(availTopic, "online", true);
    sendDiscovery();
    mqtt.subscribe(setTopic);
    mqtt.subscribe(HA_STATUS_TOPIC);
    setLed(ledIsOn());  // report the current state
  } else {
    Serial.printf("failed (state %d), retrying in 5 s\n", mqtt.state());
  }
}

void haBegin() {
  if (onEmulator()) deviceId = MQTT_USER "-lab";
  snprintf(stateTopic, sizeof(stateTopic), "home/%s/led/state", deviceId);
  snprintf(setTopic, sizeof(setTopic), "home/%s/led/set", deviceId);
  snprintf(availTopic, sizeof(availTopic), "home/%s/availability", deviceId);
  snprintf(soilTopic, sizeof(soilTopic), "home/%s/soil", deviceId);
  mqtt.setServer(onEmulator() ? LAB_MQTT_HOST : MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);  // the discovery configs are bigger than the default 256 bytes
  // Default 15 s: the broker gives up after 22 s without a ping. 60 s rides out short Wi-Fi hiccups;
  // a real power cut still shows offline within ~90 s through the Last Will
  mqtt.setKeepAlive(60);
}

void haLoop(unsigned long now) {
  connectMqtt(now);
  mqtt.loop();
}

void haPublishLed(bool on) {
  mqtt.publish(stateTopic, on ? "ON" : "OFF", true);
}

void haPublishSoil(float moisture, int raw) {
  if (!mqtt.connected()) return;
  char payload[64];
  snprintf(payload, sizeof(payload), "{\"moisture\":%.0f,\"raw\":%d}", moisture, raw);
  mqtt.publish(soilTopic, payload);
}
