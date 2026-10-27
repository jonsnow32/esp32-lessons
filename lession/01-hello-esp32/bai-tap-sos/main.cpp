// Bài 01 – Bài tập 2: nháy LED theo mã Morse SOS ( ... --- ... )
#include <Arduino.h>

const int LED_PIN = 2;

// Quy ước thời gian Morse: mọi khoảng đều là bội số của 1 "đơn vị"
const int UNIT = 200;               // ms
const int DOT = UNIT;               // chấm (ngắn)  = 1 đơn vị
const int DASH = 3 * UNIT;          // gạch (dài)   = 3 đơn vị
const int SYMBOL_GAP = UNIT;        // nghỉ giữa các ký hiệu trong 1 chữ
const int LETTER_GAP = 3 * UNIT;    // nghỉ giữa các chữ cái

// Nghỉ giữa 2 lần lặp SOS: chuẩn Morse là 7 đơn vị, nhưng để dài hơn cho mắt thấy rõ điểm bắt đầu,
// nếu không chữ S cuối và S đầu vòng sau trông như 6 lần nháy ngắn liền nhau
const int REPEAT_GAP = 2000;

// Bật LED trong `duration` ms rồi tắt và nghỉ SYMBOL_GAP
void blink(int duration) {
  Serial.print(duration == DOT ? '.' : '-');
  digitalWrite(LED_PIN, HIGH);
  delay(duration);
  digitalWrite(LED_PIN, LOW);
  delay(SYMBOL_GAP);
}

// Nháy một chữ cái gồm `count` ký hiệu giống nhau (S = 3 chấm, O = 3 gạch)
void letter(char name, int count, int duration) {
  Serial.printf("%c ", name);
  for (int i = 0; i < count; i++) {
    blink(duration);
  }
  Serial.print("  ");
  delay(LETTER_GAP - SYMBOL_GAP);  // đã nghỉ SYMBOL_GAP sau ký hiệu cuối
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  letter('S', 3, DOT);
  letter('O', 3, DASH);
  letter('S', 3, DOT);
  Serial.println();

  delay(2000);  // đã nghỉ LETTER_GAP sau chữ cuối
}
