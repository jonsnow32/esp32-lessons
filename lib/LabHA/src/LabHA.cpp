#include "LabHA.h"

#include <PubSubClient.h>
#include <WiFi.h>

#if __has_include("lab_secrets.h")
#include "lab_secrets.h"
#else
#error "LabHA: copy lib/LabHA/src/lab_secrets.example.h to lab_secrets.h (same folder) and fill it in"
#endif

// ESP32 Lab's emulator reaches the computer running the lab here (a test broker, e.g. mosquitto)
static const char *const SIM_MQTT_HOST = "10.0.2.2";
static const unsigned long RETRY_MS = 5000;
static const char *const HA_STATUS = "homeassistant/status";

static WiFiClient wifi;
static PubSubClient mqtt(wifi);
static LabHA *instance = nullptr;  // PubSubClient's callback is a plain function

LabHA::LabHA(const char *name) {
  // Topics and discovery ids only take letters, digits, - and _
  size_t i = 0;
  for (; name[i] && i < sizeof(id_) - 5; i++) {
    char c = name[i];
    id_[i] = isalnum((unsigned char)c) || c == '-' || c == '_' ? c : '-';
  }
  id_[i] = 0;
}

bool LabHA::onEmulator() {
  // The emulator's chip always has MAC 24:0a:c4:12:34:56
  return ESP.getEfuseMac() == 0x563412c40a24ULL;
}

void LabHA::add(const Entity &e) {
  if (count_ < MAX_ENTITIES) entities_[count_++] = e;
  else Serial.printf("LabHA: more than %d entities, %s left out\n", MAX_ENTITIES, e.key);
}

void LabHA::addSwitch(const char *key, const char *label, SwitchHandler onChange) {
  add({key, label, nullptr, nullptr, "switch", onChange, false});
}

void LabHA::addSensor(const char *key, const char *label, const char *unit, const char *deviceClass) {
  add({key, label, unit, deviceClass, "sensor", nullptr, false});
}

void LabHA::addBinarySensor(const char *key, const char *label, const char *deviceClass) {
  add({key, label, nullptr, deviceClass, "binary_sensor", nullptr, false});
}

LabHA::Entity *LabHA::find(const char *key) {
  for (int i = 0; i < count_; i++)
    if (strcmp(entities_[i].key, key) == 0) return &entities_[i];
  return nullptr;
}

// home/lab/<id>/<key>/<leaf>
void LabHA::topic(char *out, size_t size, const char *key, const char *leaf) {
  snprintf(out, size, "home/lab/%s/%s/%s", id_, key, leaf);
}

void LabHA::begin() {
  instance = this;
  bool sim = onEmulator();
  if (sim) strcat(id_, "-sim");  // its own device: never the real board's topics
  snprintf(availTopic_, sizeof(availTopic_), "home/lab/%s/availability", id_);

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // modem sleep delays MQTT pings until the broker drops us
  WiFi.setAutoReconnect(true);
  WiFi.begin(LAB_WIFI_SSID, LAB_WIFI_PASSWORD);  // the emulator's virtual access point takes any
  Serial.printf("LabHA %s: Wi-Fi %s%s\n", id_, LAB_WIFI_SSID, sim ? " (ESP32 Lab, virtual)" : "");

  mqtt.setServer(sim ? SIM_MQTT_HOST : LAB_MQTT_HOST, LAB_MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(768);  // discovery configs are bigger than the default 256 bytes
  mqtt.setKeepAlive(60);    // rides out short Wi-Fi hiccups; a power cut still shows offline in ~90 s
}

void LabHA::connect() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  unsigned long now = millis();
  if (tried_ && now - lastTry_ < RETRY_MS) return;  // never block the loop
  tried_ = true;
  lastTry_ = now;

  // Client id lab-<id>: two boards with the same name would keep kicking each other off
  char clientId[48];
  snprintf(clientId, sizeof(clientId), "lab-%s", id_);
  bool sim = onEmulator();
  Serial.printf("LabHA: MQTT %s... ", sim ? SIM_MQTT_HOST : LAB_MQTT_HOST);
  // Last Will: if the board vanishes the broker publishes "offline" for it
  if (!mqtt.connect(clientId, sim ? nullptr : LAB_MQTT_USER, sim ? nullptr : LAB_MQTT_PASSWORD, availTopic_, 1, true,
                    "offline")) {
    Serial.printf("failed (state %d), retrying in 5 s\n", mqtt.state());
    return;
  }
  Serial.printf("ok (Wi-Fi %d dBm)\n", WiFi.RSSI());
  mqtt.publish(availTopic_, "online", true);
  sendDiscovery();
  mqtt.subscribe(HA_STATUS);
  char t[96];
  for (int i = 0; i < count_; i++) {
    Entity &e = entities_[i];
    if (e.onChange) {
      topic(t, sizeof(t), e.key, "set");
      mqtt.subscribe(t);
    }
    if (e.onChange || strcmp(e.component, "binary_sensor") == 0) {
      topic(t, sizeof(t), e.key, "state");
      mqtt.publish(t, e.on ? "ON" : "OFF", true);  // the current state
    }
  }
}

void LabHA::sendDiscovery() {
  const char *model = onEmulator() ? "ESP32 Lab emulator" : "ESP32 Dev Module";
  char t[128], state[96], cmd[96], extra[192], config[768];
  for (int i = 0; i < count_; i++) {
    Entity &e = entities_[i];
    topic(state, sizeof(state), e.key, "state");
    extra[0] = 0;
    size_t n = 0;
    if (e.onChange) {
      topic(cmd, sizeof(cmd), e.key, "set");
      n += snprintf(extra + n, sizeof(extra) - n, ",\"command_topic\":\"%s\"", cmd);
    }
    if (e.unit) n += snprintf(extra + n, sizeof(extra) - n, ",\"unit_of_measurement\":\"%s\",\"state_class\":\"measurement\"", e.unit);
    if (e.deviceClass) n += snprintf(extra + n, sizeof(extra) - n, ",\"device_class\":\"%s\"", e.deviceClass);

    snprintf(t, sizeof(t), "homeassistant/%s/lab/%s_%s/config", e.component, id_, e.key);
    snprintf(config, sizeof(config),
             "{\"name\":\"%s\",\"unique_id\":\"lab_%s_%s\",\"state_topic\":\"%s\",\"availability_topic\":\"%s\"%s,"
             "\"device\":{\"identifiers\":[\"lab_%s\"],\"name\":\"%s\",\"model\":\"%s\"}}",
             e.label, id_, e.key, state, availTopic_, extra, id_, id_, model);
    mqtt.publish(t, config, true);
  }
}

void LabHA::onMessage(char *topic, uint8_t *payload, unsigned int length) {
  if (instance) instance->handle(topic, payload, length);
}

void LabHA::handle(char *t, uint8_t *payload, unsigned int length) {
  String message((const char *)payload, length);
  if (strcmp(t, HA_STATUS) == 0) {
    if (message == "online") sendDiscovery();  // Home Assistant restarted
    return;
  }
  char set[96];
  for (int i = 0; i < count_; i++) {
    Entity &e = entities_[i];
    if (!e.onChange) continue;
    topic(set, sizeof(set), e.key, "set");
    if (strcmp(t, set) != 0) continue;
    if (message == "ON" || message == "OFF") {
      bool on = message == "ON";
      e.onChange(on);
      setSwitch(e.key, on);
    }
    return;
  }
}

void LabHA::loop() {
  connect();
  mqtt.loop();
}

bool LabHA::connected() {
  return mqtt.connected();
}

void LabHA::publish(const char *key, float value, int decimals) {
  char text[24];
  snprintf(text, sizeof(text), "%.*f", decimals, value);
  publish(key, text);
}

void LabHA::publish(const char *key, const char *text) {
  if (!mqtt.connected()) return;
  char t[96];
  topic(t, sizeof(t), key, "state");
  mqtt.publish(t, text);
}

void LabHA::setBinary(const char *key, bool on) {
  setSwitch(key, on);  // the same ON/OFF, retained
}

void LabHA::setSwitch(const char *key, bool on) {
  Entity *e = find(key);
  if (e) e->on = on;
  if (!mqtt.connected()) return;  // sent on connect
  char t[96];
  topic(t, sizeof(t), key, "state");
  mqtt.publish(t, on ? "ON" : "OFF", true);
}
