// Home server demo – the onboard LED as an MQTT switch + a capacitive soil moisture sensor,
// both found by Home Assistant by itself
#include <Arduino.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <WiFi.h>

#include "secrets.h"  // copy secrets.example.h to secrets.h and fill it in

const int LED_PIN = 2;
const int BUTTON_PIN = 0;  // BOOT button: toggles the LED by hand too
const int SOIL_PIN = 34;   // soil sensor AOUT – must be ADC1 (GPIO32–39): ADC2 stops working with Wi-Fi on

// Calibration: read "raw" on Serial with the probe dry in air, then in a glass of water
const int SOIL_DRY_RAW = 2800;  // raw value when dry  -> 0 %
const int SOIL_WET_RAW = 1200;  // raw value in water  -> 100 %

// Topics, all under home/<device id>/
#define BASE "home/" MQTT_USER
const char *STATE_TOPIC = BASE "/led/state";  // we publish ON/OFF (retained)
const char *SET_TOPIC = BASE "/led/set";      // Home Assistant sends ON/OFF here
const char *AVAIL_TOPIC = BASE "/availability";
const char *SOIL_TOPIC = BASE "/soil";        // {"moisture":..,"raw":..}
// Home Assistant MQTT discovery: publishing this config makes the switch appear in HA
const char *DISCOVERY_TOPIC = "homeassistant/switch/" MQTT_USER "/led/config";
const char *HA_STATUS_TOPIC = "homeassistant/status";

const unsigned long RETRY_INTERVAL = 5000;    // try the broker again every 5 s
const unsigned long DEBOUNCE_MS = 50;
const unsigned long SENSOR_INTERVAL = 10000;  // soil moisture changes slowly: every 10 s is plenty

WiFiClient wifi;
PubSubClient mqtt(wifi);
Preferences prefs;  // keeps the LED state in flash so it survives a restart

bool ledOn = false;
// ESP32 Lab's emulator has no radio (WiFi.mode() stops it there): on it, only the LED, BOOT and soil sensor run
bool hasRadio = true;
unsigned long lastRetryTime = 0;
unsigned long nextSensorTime = 1000;  // first read 1 s after power-up

int lastReading = HIGH;
int stableState = HIGH;
unsigned long lastChangeTime = 0;

void setLed(bool on) {
  if (on != ledOn) prefs.putBool("led", on);  // write flash only when it changes
  ledOn = on;
  digitalWrite(LED_PIN, on ? HIGH : LOW);
  if (hasRadio) mqtt.publish(STATE_TOPIC, on ? "ON" : "OFF", true);
  Serial.printf("LED %s\n", on ? "ON" : "OFF");
}

// One HA sensor reading a field out of the soil JSON
void sendSensorDiscovery(const char *key, const char *name, const char *deviceClass, const char *unit) {
  char topic[96];
  snprintf(topic, sizeof(topic), "homeassistant/sensor/%s/%s/config", MQTT_USER, key);
  char config[512];
  snprintf(config, sizeof(config),
           "{\"name\":\"%s\",\"unique_id\":\"%s-%s\",\"device_class\":\"%s\","
           "\"unit_of_measurement\":\"%s\",\"state_class\":\"measurement\","
           "\"state_topic\":\"%s\",\"value_template\":\"{{ value_json.%s }}\","
           "\"availability_topic\":\"%s\",\"device\":{\"identifiers\":[\"%s\"]}}",
           name, MQTT_USER, key, deviceClass, unit, SOIL_TOPIC, key, AVAIL_TOPIC, MQTT_USER);
  mqtt.publish(topic, config, true);
}

// An empty retained config removes an old sensor from Home Assistant
void removeSensorDiscovery(const char *key) {
  char topic[96];
  snprintf(topic, sizeof(topic), "homeassistant/sensor/%s/%s/config", MQTT_USER, key);
  mqtt.publish(topic, "", true);
}

void sendDiscovery() {
  char config[512];
  snprintf(config, sizeof(config),
           "{\"name\":\"LED\",\"unique_id\":\"%s-led\","
           "\"command_topic\":\"%s\",\"state_topic\":\"%s\",\"availability_topic\":\"%s\","
           "\"device\":{\"identifiers\":[\"%s\"],\"name\":\"%s\",\"model\":\"ESP32 Dev Module\"}}",
           MQTT_USER, SET_TOPIC, STATE_TOPIC, AVAIL_TOPIC, MQTT_USER, MQTT_USER);
  mqtt.publish(DISCOVERY_TOPIC, config, true);
  sendSensorDiscovery("moisture", "Độ ẩm đất", "moisture", "%");
  // The DHT22 is gone: clear its two sensors from Home Assistant
  removeSensorDiscovery("temperature");
  removeSensorDiscovery("humidity");
}

void onMessage(char *topic, byte *payload, unsigned int length) {
  String message((const char *)payload, length);
  if (strcmp(topic, SET_TOPIC) == 0) {
    if (message == "ON") setLed(true);
    else if (message == "OFF") setLed(false);
  } else if (strcmp(topic, HA_STATUS_TOPIC) == 0 && message == "online") {
    sendDiscovery();  // Home Assistant restarted
  }
}

void connectMqtt(unsigned long now) {
  if (!hasRadio || mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  // Not time yet? Return right away – never block the loop
  if (now - lastRetryTime < RETRY_INTERVAL && lastRetryTime != 0) return;
  lastRetryTime = now;

  Serial.print("MQTT connecting... ");
  // Last Will: if we vanish (power cut, Wi-Fi lost) the broker publishes "offline" for us
  if (mqtt.connect(MQTT_USER, MQTT_USER, MQTT_PASSWORD, AVAIL_TOPIC, 1, true, "offline")) {
    // Below about -75 dBm the link drops often: move the board or the router closer
    Serial.printf("ok (Wi-Fi %d dBm)\n", WiFi.RSSI());
    mqtt.publish(AVAIL_TOPIC, "online", true);
    sendDiscovery();
    mqtt.subscribe(SET_TOPIC);
    mqtt.subscribe(HA_STATUS_TOPIC);
    setLed(ledOn);  // report the current state
  } else {
    Serial.printf("failed (state %d), retrying in 5 s\n", mqtt.state());
  }
}

void updateButton(unsigned long now) {
  int reading = digitalRead(BUTTON_PIN);
  if (reading != lastReading) {
    lastChangeTime = now;
    lastReading = reading;
  }
  if (now - lastChangeTime >= DEBOUNCE_MS && reading != stableState) {
    stableState = reading;
    if (stableState == LOW) setLed(!ledOn);
  }
}

// Average a few samples: the ESP32 ADC is a bit noisy
int readSoilRaw() {
  long sum = 0;
  for (int i = 0; i < 16; i++) sum += analogRead(SOIL_PIN);
  return sum / 16;
}

void updateSensor(unsigned long now) {
  if ((long)(now - nextSensorTime) < 0) return;  // not time yet
  nextSensorTime = now + SENSOR_INTERVAL;

  int raw = readSoilRaw();  // 0–4095
  // Wetter soil -> LOWER voltage, so dry maps to 0 % and wet to 100 %
  float moisture = (float)(SOIL_DRY_RAW - raw) * 100.0f / (SOIL_DRY_RAW - SOIL_WET_RAW);
  moisture = constrain(moisture, 0.0f, 100.0f);
  Serial.printf("Soil moisture %.0f %% (raw %d)\n", moisture, raw);

  if (hasRadio && mqtt.connected()) {
    char payload[64];
    snprintf(payload, sizeof(payload), "{\"moisture\":%.0f,\"raw\":%d}", moisture, raw);
    mqtt.publish(SOIL_TOPIC, payload);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  analogReadResolution(12);                     // 0–4095
  analogSetPinAttenuation(SOIL_PIN, ADC_11db);  // full 0–3,3 V range

  // Back to the state before the restart; reported to Home Assistant once MQTT connects
  prefs.begin("esp32-mqtt");
  ledOn = prefs.getBool("led", false);
  digitalWrite(LED_PIN, ledOn ? HIGH : LOW);

  // The emulator's chip always has MAC 24:0a:c4:12:34:56
  if (ESP.getEfuseMac() == 0x563412c40a24ULL) {
    hasRadio = false;
    Serial.println("Emulator: no Wi-Fi here, the BOOT button and the soil sensor still work");
    return;
  }

  WiFi.mode(WIFI_STA);
  // Modem sleep (the default) delays MQTT pings until the broker drops us ("exceeded timeout")
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);  // reconnects by itself if the router drops
  Serial.printf("Wi-Fi connecting to %s\n", WIFI_SSID);

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);  // the discovery configs are bigger than the default 256 bytes
  // Default 15 s: the broker gives up after 22 s without a ping. 60 s rides out short Wi-Fi hiccups;
  // a real power cut still shows offline within ~90 s through the Last Will
  mqtt.setKeepAlive(60);
}

void loop() {
  unsigned long now = millis();
  connectMqtt(now);
  if (hasRadio) mqtt.loop();
  updateButton(now);
  updateSensor(now);
}
