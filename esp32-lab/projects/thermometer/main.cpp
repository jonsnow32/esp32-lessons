// NTC thermometer: 3.3 V -> NTC -> GPIO34 -> 10 kOhm -> GND. The NTC's resistance falls as it
// warms, so the voltage at GPIO34 rises. Read it with the ADC, work out the NTC's resistance
// from the divider, then the temperature from the Beta equation.
#include <Arduino.h>

const int SENSOR_PIN = 34;  // ADC1: still works when Wi-Fi is on
const int LED_PIN = 22;

const float V_SUPPLY = 3300.0;  // mV
const float R_FIXED = 10000.0;  // the divider's resistor
const float R25 = 10000.0;      // NTC at 25 C
const float BETA = 3950.0;
const float HOT = 35.0;         // C: warning light above this

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("=== Nhiet ke NTC ===");
}

void loop() {
  int raw = analogRead(SENSOR_PIN);              // 0..4095
  int mv = analogReadMilliVolts(SENSOR_PIN);     // calibrated millivolts
  if (mv <= 0 || mv >= V_SUPPLY) {
    Serial.println("Ngoai dai do: kiem tra day noi");
  } else {
    // Divider: mv = V_SUPPLY * R_FIXED / (R_ntc + R_FIXED)
    float rNtc = R_FIXED * (V_SUPPLY - mv) / mv;
    float kelvin = 1.0 / (1.0 / 298.15 + log(rNtc / R25) / BETA);
    float celsius = kelvin - 273.15;
    Serial.printf("ADC %4d | %4d mV | NTC %6.0f ohm | %5.1f C\n", raw, mv, rNtc, celsius);
    digitalWrite(LED_PIN, celsius > HOT ? HIGH : LOW);
  }
  delay(500);
}
