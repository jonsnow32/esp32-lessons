// Automatic plant watering: a capacitive soil probe on GPIO34, a relay on GPIO23 that switches a
// 5 V mini pump through COM-NO, and a green LED on GPIO2 while it waters. Water below DRY_START,
// stop at WET_STOP: the gap between them keeps the pump from chattering on and off.
#include <Arduino.h>

const int SENSOR_PIN = 34;  // ADC1: still works when Wi-Fi is on
const int RELAY_PIN = 23;
const int LED_PIN = 2;

// The probe's AOUT in air (0 %) and in a glass of water (100 %). Measure your own probe and put
// its numbers here: every probe and soil is a little different.
const int DRY_MV = 2700;
const int WET_MV = 1190;

const int DRY_START = 30;  // %: start watering below this
const int WET_STOP = 60;   // %: stop once the soil is this wet
const unsigned long MAX_PUMP_MS = 10000;  // never pump longer than this in one go
const unsigned long REST_MS = 5000;       // then wait before trying again

bool pumping = false;
unsigned long pumpStart = 0;
unsigned long restUntil = 0;

/** Soil moisture in %, from the average of a few ADC readings. */
int readMoisture() {
  long sum = 0;
  for (int i = 0; i < 8; i++) sum += analogReadMilliVolts(SENSOR_PIN);
  int mv = sum / 8;
  // Wetter soil reads LOWER, so dry maps to 0 % and wet to 100 %
  return constrain(map(mv, DRY_MV, WET_MV, 0, 100), 0, 100);
}

void setPump(bool on) {
  pumping = on;
  digitalWrite(RELAY_PIN, on ? HIGH : LOW);
  digitalWrite(LED_PIN, on ? HIGH : LOW);
  if (on) pumpStart = millis();
}

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  setPump(false);
  Serial.println("=== Tuoi cay tu dong ===");
}

void loop() {
  int moisture = readMoisture();
  unsigned long now = millis();

  if (pumping) {
    if (moisture >= WET_STOP) {
      setPump(false);
      Serial.println("Du nuoc -> tat bom");
    } else if (now - pumpStart > MAX_PUMP_MS) {
      // Still dry after the longest run: the bucket is empty or a hose came off
      setPump(false);
      restUntil = now + REST_MS;
      Serial.println("Bom qua lau ma dat van kho: kiem tra nuoc / ong / day bom");
    }
  } else if (moisture < DRY_START && now >= restUntil) {
    setPump(true);
    Serial.println("Dat kho -> bat bom");
  }

  Serial.printf("Do am: %3d %% | Bom: %s\n", moisture, pumping ? "BAT" : "TAT");
  delay(500);
}
