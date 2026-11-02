// LabHA starting point: the onboard LED as a switch, the BOOT button as a binary sensor and the
// uptime as a sensor, all in Home Assistant as device "vi-du" with no setup there.
// Wi-Fi and the broker come from lib/LabHA/src/lab_secrets.h: nothing to configure here but a name.
#include <Arduino.h>
#include <LabHA.h>

constexpr int LED_PIN = 2;
constexpr int BUTTON_PIN = 0;

LabHA ha("vi-du");  // unique per board

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  ha.addSwitch("led", "Đèn", [](bool on) { digitalWrite(LED_PIN, on); });
  ha.addBinarySensor("button", "Nút BOOT");
  ha.addSensor("uptime", "Thời gian chạy", "s", "duration");
  ha.begin();
}

void loop() {
  ha.loop();

  static bool lastPressed = false;
  bool pressed = digitalRead(BUTTON_PIN) == LOW;
  if (pressed != lastPressed) {
    lastPressed = pressed;
    ha.setBinary("button", pressed);
  }

  static unsigned long lastSent = 0;
  if (millis() - lastSent >= 10000) {
    lastSent = millis();
    ha.publish("uptime", millis() / 1000, 0);
  }
}
