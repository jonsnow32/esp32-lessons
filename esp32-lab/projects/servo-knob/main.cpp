// Servo follows the knob: read the potentiometer on GPIO34, turn it into an angle, and send the
// servo the matching pulse with the LEDC PWM unit: 50 pulses a second, 0.5 ms wide for 0 deg up
// to 2.5 ms for 180 deg. The board's LED (GPIO2) shows the same value as brightness.
#include <Arduino.h>

const int POT_PIN = 34;
const int SERVO_PIN = 18;
const int LED_PIN = 2;

const int SERVO_HZ = 50;           // one pulse every 20 ms
const int SERVO_BITS = 16;         // duty 0..65535 for the whole 20 ms
const int PULSE_MIN_US = 500;      // 0 deg
const int PULSE_MAX_US = 2500;     // 180 deg

int lastAngle = -100;  // far from any angle, so the first one is printed

void setup() {
  Serial.begin(115200);
  ledcAttach(SERVO_PIN, SERVO_HZ, SERVO_BITS);
  Serial.println("=== Servo theo num van ===");
}

void loop() {
  int raw = analogRead(POT_PIN);                 // 0..4095
  int angle = map(raw, 0, 4095, 0, 180);
  int pulseUs = map(angle, 0, 180, PULSE_MIN_US, PULSE_MAX_US);
  // Fraction of the 20 ms period that is HIGH, as a 16-bit duty
  ledcWrite(SERVO_PIN, (uint32_t)pulseUs * 65536 / 20000);
  analogWrite(LED_PIN, raw / 16);                // 0..255

  if (abs(angle - lastAngle) >= 2) {
    lastAngle = angle;
    Serial.printf("Goc %3d do  (xung %4d us)\n", angle, pulseUs);
  }
  delay(20);
}
