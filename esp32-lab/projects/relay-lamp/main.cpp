// Relay lamp: each button press toggles the relay. The relay's coil runs from VIN (5 V); the
// ESP32 only drives the module's IN pin. The lamp sits on its own circuit through COM and NO.
#include <Arduino.h>

const int RELAY_PIN = 23;
const int BUTTON_PIN = 4;

bool on = false;
int lastButton = HIGH;
unsigned long lastChange = 0;

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  Serial.println("=== Bat den bang relay ===");
}

void loop() {
  int b = digitalRead(BUTTON_PIN);
  if (b != lastButton) {
    lastButton = b;
    lastChange = millis();
  } else if (b == LOW && lastChange != 0 && millis() - lastChange > 30) {
    // Held LOW for 30 ms: a real press, not contact bounce
    lastChange = 0;
    on = !on;
    digitalWrite(RELAY_PIN, on ? HIGH : LOW);
    Serial.println(on ? "Relay BAT -> den sang" : "Relay TAT -> den tat");
  }
}
