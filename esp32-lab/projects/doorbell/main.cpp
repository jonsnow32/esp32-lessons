// Doorbell: press the button and the active buzzer plays "beep... beeeep".
// The button is debounced and the melody runs on millis(), so loop() never blocks.
#include <Arduino.h>

const int BUTTON_PIN = 4;  // other side of the button goes to GND
const int BUZZER_PIN = 23;
const unsigned long DEBOUNCE_MS = 30;

// Alternating ON / OFF durations in ms, starting with ON
const unsigned long MELODY[] = {200, 150, 500};
const int MELODY_STEPS = sizeof(MELODY) / sizeof(MELODY[0]);

bool lastReading = false;
bool pressed = false;
unsigned long lastFlip = 0;
int step = -1;  // -1: silent
unsigned long stepStart = 0;
int rings = 0;

void ring() {
  rings++;
  Serial.printf("Ding dong! (lan %d)\n", rings);
  step = 0;
  stepStart = millis();
  digitalWrite(BUZZER_PIN, HIGH);
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);
  Serial.println("=== Chuong cua: nhan nut de bam chuong ===");
}

void loop() {
  // Debounce: accept a new state only after it has been stable for DEBOUNCE_MS
  bool reading = digitalRead(BUTTON_PIN) == LOW;
  if (reading != lastReading) {
    lastReading = reading;
    lastFlip = millis();
  }
  if (millis() - lastFlip >= DEBOUNCE_MS && reading != pressed) {
    pressed = reading;
    if (pressed && step < 0) ring();
  }

  // Melody: move to the next step when the current one has lasted long enough
  if (step >= 0 && millis() - stepStart >= MELODY[step]) {
    stepStart += MELODY[step];
    step++;
    if (step >= MELODY_STEPS) {
      step = -1;
      digitalWrite(BUZZER_PIN, LOW);
    } else {
      digitalWrite(BUZZER_PIN, step % 2 == 0 ? HIGH : LOW);
    }
  }
}
