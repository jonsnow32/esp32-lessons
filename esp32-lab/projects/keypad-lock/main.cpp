// Keypad lock: a 4x4 matrix keypad scanned by hand. Each row in turn is driven LOW while the
// others stay HIGH; a column that then reads LOW (columns use the internal pull-up) has its key
// pressed. Type the code, then # to open; * clears what you typed.
#include <Arduino.h>

const int ROW_PINS[4] = {32, 33, 25, 26};  // R1..R4
const int COL_PINS[4] = {27, 14, 18, 19};  // C1..C4
const char KEYS[4][4] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'},
};
const int GREEN_PIN = 22;
const int RED_PIN = 23;
const String CODE = "1234";

String typed = "";
char lastKey = 0;
unsigned long ledOff = 0;

// The key held down right now, or 0
char scan() {
  char found = 0;
  for (int r = 0; r < 4; r++) {
    digitalWrite(ROW_PINS[r], LOW);
    delayMicroseconds(5);  // let the line settle
    for (int c = 0; c < 4; c++) {
      if (digitalRead(COL_PINS[c]) == LOW) found = KEYS[r][c];
    }
    digitalWrite(ROW_PINS[r], HIGH);
  }
  return found;
}

void setup() {
  Serial.begin(115200);
  for (int r = 0; r < 4; r++) {
    pinMode(ROW_PINS[r], OUTPUT);
    digitalWrite(ROW_PINS[r], HIGH);
  }
  for (int c = 0; c < 4; c++) pinMode(COL_PINS[c], INPUT_PULLUP);
  pinMode(GREEN_PIN, OUTPUT);
  pinMode(RED_PIN, OUTPUT);
  Serial.println("=== Khoa so: go ma roi nhan # ===");
}

void loop() {
  char key = scan();
  // React once per press, when the key goes down
  if (key && key != lastKey) {
    Serial.print("Phim: ");
    Serial.println(key);
    if (key == '*') {
      typed = "";
      Serial.println("Xoa");
    } else if (key == '#') {
      bool ok = typed == CODE;
      Serial.println(ok ? "Mo khoa!" : "Sai ma");
      digitalWrite(ok ? GREEN_PIN : RED_PIN, HIGH);
      ledOff = millis() + (ok ? 3000 : 1000);
      typed = "";
    } else {
      typed += key;
    }
  }
  lastKey = key;

  if (ledOff && millis() > ledOff) {
    digitalWrite(GREEN_PIN, LOW);
    digitalWrite(RED_PIN, LOW);
    ledOff = 0;
  }
  delay(20);  // scanning 50 times a second is plenty, and rides out contact bounce
}
