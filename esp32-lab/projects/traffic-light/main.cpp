// Traffic light: green -> yellow -> red, timed with millis() so loop() never waits.
#include <Arduino.h>

const int RED_PIN = 23;
const int YELLOW_PIN = 22;
const int GREEN_PIN = 21;

struct Phase {
  int pin;
  unsigned long ms;
  const char *name;
};

const Phase PHASES[] = {
    {GREEN_PIN, 4000, "XANH - di"},
    {YELLOW_PIN, 1500, "VANG - cham lai"},
    {RED_PIN, 4000, "DO - dung lai"},
};
const int PHASE_COUNT = sizeof(PHASES) / sizeof(PHASES[0]);

int phase = 0;
unsigned long phaseStart = 0;

void show(int p) {
  for (const Phase &ph : PHASES) digitalWrite(ph.pin, LOW);
  digitalWrite(PHASES[p].pin, HIGH);
  Serial.printf("[%5lu ms] Den %s\n", millis(), PHASES[p].name);
}

void setup() {
  Serial.begin(115200);
  for (const Phase &ph : PHASES) pinMode(ph.pin, OUTPUT);
  Serial.println("=== Den giao thong ===");
  phaseStart = millis();
  show(phase);
}

void loop() {
  if (millis() - phaseStart >= PHASES[phase].ms) {
    phaseStart += PHASES[phase].ms;
    phase = (phase + 1) % PHASE_COUNT;
    show(phase);
  }
}
