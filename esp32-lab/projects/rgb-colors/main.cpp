// RGB LED (common cathode): switch red, green and blue on and off to mix 7 colours.
#include <Arduino.h>

const int R_PIN = 21;
const int G_PIN = 19;
const int B_PIN = 18;

struct Color {
  bool r, g, b;
  const char *name;
};

const Color COLORS[] = {
    {1, 0, 0, "Do"},      {0, 1, 0, "Xanh la"},   {0, 0, 1, "Xanh duong"}, {1, 1, 0, "Vang"},
    {0, 1, 1, "Xanh ngoc"}, {1, 0, 1, "Tim"},     {1, 1, 1, "Trang"},
};
const int COLOR_COUNT = sizeof(COLORS) / sizeof(COLORS[0]);
const unsigned long STEP_MS = 800;

int current = 0;
unsigned long lastChange = 0;

void show(const Color &c) {
  digitalWrite(R_PIN, c.r ? HIGH : LOW);
  digitalWrite(G_PIN, c.g ? HIGH : LOW);
  digitalWrite(B_PIN, c.b ? HIGH : LOW);
  Serial.printf("Mau: %s\n", c.name);
}

void setup() {
  Serial.begin(115200);
  pinMode(R_PIN, OUTPUT);
  pinMode(G_PIN, OUTPUT);
  pinMode(B_PIN, OUTPUT);
  Serial.println("=== LED RGB 7 mau ===");
  show(COLORS[current]);
  lastChange = millis();
}

void loop() {
  if (millis() - lastChange >= STEP_MS) {
    lastChange += STEP_MS;
    current = (current + 1) % COLOR_COUNT;
    show(COLORS[current]);
  }
}
