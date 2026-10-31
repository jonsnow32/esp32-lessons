// Home server demo – the onboard LED as an MQTT switch that Home Assistant finds by itself
#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFi.h>

#include "secrets.h"  // copy secrets.example.h to secrets.h and fill it in

const int LED_PIN = 2;
const int BUTTON_PIN = 0;  // BOOT button: toggles the LED by hand too

// Topics, all under home/<device id>/
#define BASE "home/" MQTT_USER
const char *STATE_TOPIC = BASE "/led/state";  // we publish ON/OFF (retained)
const char *SET_TOPIC = BASE "/led/set";      // Home Assistant sends ON/OFF here
const char *AVAIL_TOPIC = BASE "/availability";
// Home Assistant MQTT discovery: publishing this config makes the switch appear in HA
const char *DISCOVERY_TOPIC = "homeassistant/switch/" MQTT_USER "/led/config";
const char *HA_STATUS_TOPIC = "homeassistant/status";

const unsigned long RETRY_INTERVAL = 5000;  // try the broker again every 5 s
const unsigned long DEBOUNCE_MS = 50;

WiFiClient wifi;
PubSubClient mqtt(wifi);

bool ledOn = false;
unsigned long lastRetryTime = 0;

int lastReading = HIGH;
int stableState = HIGH;
unsigned long lastChangeTime = 0;

void setLed(bool on) {
  ledOn = on;
  digitalWrite(LED_PIN, on ? HIGH : LOW);
  mqtt.publish(STATE_TOPIC, on ? "ON" : "OFF", true);
  Serial.printf("LED %s\n", on ? "ON" : "OFF");
}

void sendDiscovery() {
  char config[512];
  snprintf(config, sizeof(config),
           "{\"name\":\"LED\",\"unique_id\":\"%s-led\","
           "\"command_topic\":\"%s\",\"state_topic\":\"%s\",\"availability_topic\":\"%s\","
           "\"device\":{\"identifiers\":[\"%s\"],\"name\":\"%s\",\"model\":\"ESP32 Dev Module\"}}",
           MQTT_USER, SET_TOPIC, STATE_TOPIC, AVAIL_TOPIC, MQTT_USER, MQTT_USER);
  mqtt.publish(DISCOVERY_TOPIC, config, true);
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
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  // Not time yet? Return right away – never block the loop
  if (now - lastRetryTime < RETRY_INTERVAL && lastRetryTime != 0) return;
  lastRetryTime = now;

  Serial.print("MQTT connecting... ");
  // Last Will: if we vanish (power cut, Wi-Fi lost) the broker publishes "offline" for us
  if (mqtt.connect(MQTT_USER, MQTT_USER, MQTT_PASSWORD, AVAIL_TOPIC, 1, true, "offline")) {
    Serial.println("ok");
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

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);  // reconnects by itself if the router drops
  Serial.printf("Wi-Fi connecting to %s\n", WIFI_SSID);

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);  // the discovery config is bigger than the default 256 bytes
}

void loop() {
  unsigned long now = millis();
  connectMqtt(now);
  mqtt.loop();
  updateButton(now);
}
