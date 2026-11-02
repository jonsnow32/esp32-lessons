#include "soil.h"

#include <Arduino.h>

#include "config.h"
#include "ha.h"

static unsigned long nextSensorTime = 1000;  // first read 1 s after power-up

void soilBegin() {
  analogReadResolution(12);                     // 0–4095
  analogSetPinAttenuation(SOIL_PIN, ADC_11db);  // full 0–3,3 V range
}

// Average a few samples: the ESP32 ADC is a bit noisy
static int readSoilRaw() {
  long sum = 0;
  for (int i = 0; i < 16; i++) sum += analogRead(SOIL_PIN);
  return sum / 16;
}

void updateSoil(unsigned long now) {
  if ((long)(now - nextSensorTime) < 0) return;  // not time yet
  nextSensorTime = now + SENSOR_INTERVAL;

  int raw = readSoilRaw();  // 0–4095
  // Wetter soil -> LOWER voltage, so dry maps to 0 % and wet to 100 %
  float moisture = (float)(SOIL_DRY_RAW - raw) * 100.0f / (SOIL_DRY_RAW - SOIL_WET_RAW);
  moisture = constrain(moisture, 0.0f, 100.0f);
  Serial.printf("Soil moisture %.0f %% (raw %d)\n", moisture, raw);
  ha.publish("moisture", moisture, 0);
}
