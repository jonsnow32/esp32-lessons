// Wi-Fi, MQTT and Home Assistant discovery for any lab board, from one lab_secrets.h.
//
//   #include <LabHA.h>
//   LabHA ha("tuoi-cay");                        // this board's name: letters, digits, - and _
//
//   void setup() {
//     ha.addSwitch("led", "Đèn", [](bool on) { digitalWrite(2, on); });
//     ha.addSensor("moisture", "Độ ẩm đất", "%", "moisture");
//     ha.begin();                                 // Wi-Fi + broker, reconnects by itself
//   }
//   void loop() {
//     ha.loop();                                  // never blocks
//     ha.publish("moisture", 42);                 // a sensor's value
//     ha.setSwitch("led", true);                  // a switch changed by hand
//   }
//
// Topics: home/lab/<name>/<key>/state, home/lab/<name>/<key>/set (switches),
// home/lab/<name>/availability; discovery: homeassistant/<component>/lab/<name>_<key>/config.
// In Home Assistant every board is a device named <name>, with its entities.
//
// On ESP32 Lab's emulator the board is <name>-sim and talks to the test broker on the computer
// running the lab (10.0.2.2) without a password, never to the home server.
//
// A board with its own broker account (not the shared "lab" one, no lab_secrets.h needed):
//
//   LabHA ha(LabHA::Account{WIFI_SSID, WIFI_PASSWORD, MQTT_HOST, MQTT_PORT, MQTT_USER, MQTT_PASSWORD});
//
// The MQTT user is then the device id, as the broker's ACL wants (home/%u/#): topics
// home/<user>/<key>/state, home/<user>/<key>/set, home/<user>/availability; discovery
// homeassistant/<component>/<user>/<key>/config, unique_id <user>-<key>. On the emulator it is
// <user>-lab.
#pragma once

#include <Arduino.h>

class LabHA {
 public:
  using SwitchHandler = void (*)(bool on);

  // Wi-Fi and broker of a board that has its own account
  struct Account {
    const char *wifiSsid, *wifiPassword;
    const char *mqttHost;
    uint16_t mqttPort;
    const char *mqttUser, *mqttPassword;  // the user is also the device id
  };

  explicit LabHA(const char *name);          // a lab board: shared settings from lab_secrets.h
  explicit LabHA(const Account &own);        // a board with its own account

  // Declare entities before begin(), at most 12
  void addSwitch(const char *key, const char *label, SwitchHandler onChange);
  // deviceClass: "temperature", "humidity", "moisture", "illuminance"… or nullptr
  void addSensor(const char *key, const char *label, const char *unit = nullptr, const char *deviceClass = nullptr);
  // deviceClass: "motion", "door", "occupancy"… or nullptr
  void addBinarySensor(const char *key, const char *label, const char *deviceClass = nullptr);

  void begin();
  void loop();

  void publish(const char *key, float value, int decimals = 1);  // a sensor
  void publish(const char *key, const char *text);                // a sensor, as text
  void setBinary(const char *key, bool on);                       // a binary sensor
  void setSwitch(const char *key, bool on);                       // report a switch's state

  bool connected();
  bool onEmulator();
  const char *deviceId() const { return id_; }

 private:
  struct Entity {
    const char *key, *label, *unit, *deviceClass;
    const char *component;  // "switch", "sensor", "binary_sensor"
    SwitchHandler onChange;
    bool on;
  };
  static constexpr int MAX_ENTITIES = 12;

  Entity entities_[MAX_ENTITIES];
  int count_ = 0;
  Account account_;
  bool own_;  // its own account: topics home/<id>/..., not home/lab/<id>/...
  char id_[40];
  char availTopic_[80];
  unsigned long lastTry_ = 0;
  bool tried_ = false;
  bool started_ = false;  // begin() found its settings

  void setId(const char *name);
  void add(const Entity &e);
  Entity *find(const char *key);
  void topic(char *out, size_t size, const char *key, const char *leaf);
  int base(char *out, size_t size);  // home/lab/<id> or home/<id>
  void connect();
  void sendDiscovery();
  void handle(char *topic, uint8_t *payload, unsigned int length);
  static void onMessage(char *topic, uint8_t *payload, unsigned int length);
};
