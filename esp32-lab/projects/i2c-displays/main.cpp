// Two displays on one I2C bus: an NTC thermistor (with 10 kOhm to GND) on GPIO34 gives the
// temperature; the 16x2 LCD shows it as text, the OLED draws its history as a graph. Each
// display has its own address, so both share SDA (GPIO21) and SCL (GPIO22).
#include <Arduino.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

const uint8_t LCD_ADDR = 0x27;
const uint8_t OLED_ADDR = 0x3C;
const int SENSOR_PIN = 34;

LiquidCrystal_I2C lcd(LCD_ADDR, 16, 2);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);

// A custom character for the degree sign, row by row (5 dots wide)
byte DEGREE[8] = {0b01100, 0b10010, 0b10010, 0b01100, 0, 0, 0, 0};

const int HISTORY = 100;
float history[HISTORY];
int count = 0;

float readCelsius() {
  int mv = analogReadMilliVolts(SENSOR_PIN);
  if (mv <= 0 || mv >= 3300) return NAN;
  float rNtc = 10000.0 * (3300 - mv) / mv;      // divider: 3.3 V -> NTC -> pin -> 10 kOhm -> GND
  float kelvin = 1.0 / (1.0 / 298.15 + log(rNtc / 10000.0) / 3950.0);
  return kelvin - 273.15;
}

bool present(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  Serial.printf("LCD 0x%02X: %s, OLED 0x%02X: %s\n", LCD_ADDR, present(LCD_ADDR) ? "co" : "KHONG thay",
                OLED_ADDR, present(OLED_ADDR) ? "co" : "KHONG thay");

  lcd.init();
  lcd.backlight();
  lcd.createChar(0, DEGREE);
  lcd.setCursor(0, 0);  // createChar leaves the LCD writing into its character RAM
  lcd.print("Nhiet do:");

  oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  oled.setTextColor(SSD1306_WHITE);
}

void loop() {
  float c = readCelsius();
  if (count < HISTORY) count++;
  memmove(history, history + 1, sizeof(float) * (HISTORY - 1));
  history[HISTORY - 1] = c;

  lcd.setCursor(0, 1);
  lcd.printf("%6.1f", c);
  lcd.write(byte(0));
  lcd.print("C    ");

  // Graph: -10..60 C over the bottom 48 rows, newest sample on the right
  oled.clearDisplay();
  oled.setTextSize(2);
  oled.setCursor(0, 0);
  oled.printf("%.1f C", c);
  for (int i = HISTORY - count + 1; i < HISTORY; i++) {
    int x0 = 27 + i - 1, x1 = 27 + i;
    int y0 = 63 - constrain((int)((history[i - 1] + 10) * 47 / 70), 0, 47);
    int y1 = 63 - constrain((int)((history[i] + 10) * 47 / 70), 0, 47);
    oled.drawLine(x0, y0, x1, y1, SSD1306_WHITE);
  }
  oled.display();

  Serial.printf("%.1f C\n", c);
  delay(250);
}
