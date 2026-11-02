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
#pragma once

#include <Arduino.h>

class LabHA {
 public:
  using SwitchHandler = void (*)(bool on);

  explicit LabHA(const char *name);

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
  char id_[40];
  char availTopic_[80];
  unsigned long lastTry_ = 0;
  bool tried_ = false;

  void add(const Entity &e);
  Entity *find(const char *key);
  void topic(char *out, size_t size, const char *key, const char *leaf);
  void connect();
  void sendDiscovery();
  void handle(char *topic, uint8_t *payload, unsigned int length);
  static void onMessage(char *topic, uint8_t *payload, unsigned int length);
};
