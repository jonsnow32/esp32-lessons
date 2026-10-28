// Lesson 03 – millis(): blink, read a button and print at the same time – no delay()
#include <Arduino.h>

const int LED_PIN = 2;
const int BUTTON_PIN = 0;  // BOOT button

// Blink speeds (ms between LED toggles); 0 = off
const unsigned long BLINK_INTERVALS[] = {1000, 300, 80, 0};
const char *MODE_NAMES[] = {"SLOW", "MEDIUM", "FAST", "OFF"};
const int MODE_COUNT = 4;

const unsigned long DEBOUNCE_MS = 50;
const unsigned long REPORT_INTERVAL = 5000;  // print status every 5 seconds

// --- Task 1: blink the LED ---
int mode = 0;
bool ledOn = false;
unsigned long lastBlinkTime = 0;

// --- Task 2: read the button (as in lesson 02) ---
int lastReading = HIGH;
int stableState = HIGH;
unsigned long lastChangeTime = 0;

// --- Task 3: periodic report ---
unsigned long lastReportTime = 0;

void updateLed(unsigned long now) {
  unsigned long interval = BLINK_INTERVALS[mode];
  if (interval == 0) {  // OFF mode
    digitalWrite(LED_PIN, LOW);
    return;
  }
  // Time yet? If not, return right away – never wait
  if (now - lastBlinkTime >= interval) {
    lastBlinkTime = now;
    ledOn = !ledOn;
    digitalWrite(LED_PIN, ledOn ? HIGH : LOW);
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
    if (stableState == LOW) {
      mode = (mode + 1) % MODE_COUNT;  // cycle 0 → 1 → 2 → 3 → 0
      Serial.printf("[%6lu ms] Mode: %s\n", now, MODE_NAMES[mode]);
    }
  }
}

void updateReport(unsigned long now) {
  if (now - lastReportTime >= REPORT_INTERVAL) {
    lastReportTime = now;
    Serial.printf("[%6lu ms] Still running, mode %s\n", now, MODE_NAMES[mode]);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  Serial.println();
  Serial.println("=== Lesson 03 - millis() ===");
  Serial.println("Press BOOT to change blink speed");
}

void loop() {
  unsigned long now = millis();

  // Each one only asks "is it time yet?" and returns,
  // so loop() spins ~100k times/s and misses nothing
  updateLed(now);
  updateButton(now);
  updateReport(now);
}
