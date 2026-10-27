// Lesson 02 – Button: toggle the LED with the BOOT button (GPIO0), with debouncing
#include <Arduino.h>

const int LED_PIN = 2;
const int BUTTON_PIN = 0;  // BOOT button: GPIO0 to GND

// How long the signal must stay still before we trust it.
// Set to 0 to see button bounce (exercise 1).
const unsigned long DEBOUNCE_MS = 50;

int lastReading = HIGH;         // latest reading (may be bouncing)
int stableState = HIGH;         // settled state of the button
unsigned long lastChangeTime = 0;

bool ledOn = false;
int pressCount = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(LED_PIN, OUTPUT);
  // Internal pull-up: released = HIGH, pressed = LOW
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Serial.println();
  Serial.println("=== Lesson 02 - Button ===");
  Serial.println("Press BOOT to toggle the LED");
}

void loop() {
  int reading = digitalRead(BUTTON_PIN);

  // Signal changed → restart the wait
  if (reading != lastReading) {
    lastChangeTime = millis();
    lastReading = reading;
  }

  // Settled and different from before → real change
  if (millis() - lastChangeTime >= DEBOUNCE_MS &&
      reading != stableState) {
    stableState = reading;

    // Only act on PRESS, ignore release
    if (stableState == LOW) {
      pressCount++;
      ledOn = !ledOn;
      digitalWrite(LED_PIN, ledOn ? HIGH : LOW);
      Serial.printf("Press #%d -> LED %s\n",
                    pressCount, ledOn ? "ON" : "OFF");
    }
  }
}
