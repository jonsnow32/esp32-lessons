// The probe built into the sketch for live mode on a real board (see the C++ comment below and
// index.ts). Kept here as text so the desktop app's bundle carries it.

export const PROBE_FILE = 'esp32lab_probe.cpp';

export const PROBE_CPP = String.raw`// ESP32 Lab live probe: built into the sketch only for "Board thật" (the lab's live mode on a
// real board). The sketch runs untouched; a small task on core 0 reads what every usable pin is
// doing straight from the chip's registers (GPIO out / enable / in, the GPIO matrix, the IO_MUX
// pulls, LEDC for PWM) every few milliseconds and tells the lab over the same USB serial, as
// lines of their own between the sketch's output:
//
//   \x1eH esp32lab-probe 1\n                  once at start
//   \x1eL <pin>:<state><pull><in> …\n          pins that changed (every pin once a second)
//
// state: H / L driven high / low, Z not driving, X driven by another peripheral (UART, I2C, RMT),
// P<duty>/<max>@<hz> PWM from LEDC. pull: u / d / - . in: the level the pin reads, 0 / 1.
// The lab cuts these lines out of what the Serial Monitor shows. Serial runs at 115200 baud.

#include <Arduino.h>
#include "esp32-hal-ledc.h"
#include "esp32-hal-periman.h"
#include "soc/gpio_periph.h"
#include "soc/gpio_reg.h"
#include "soc/io_mux_reg.h"

namespace {

// Pins a sketch can use on an ESP32-WROOM board: not the flash pins (6–11), not UART0 (1, 3)
const uint8_t PINS[] = {0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39};
constexpr size_t N = sizeof(PINS);
constexpr uint32_t POLL_MS = 5;
constexpr uint32_t FULL_MS = 1000;
constexpr uint32_t SIMPLE_GPIO = 0x100;  // GPIO matrix: the pin follows GPIO_OUT

char last[N][24];

void describe(uint8_t pin, uint32_t out, uint32_t out1, uint32_t en, uint32_t en1, uint32_t in, uint32_t in1, char *buf, size_t len) {
  const bool low = pin < 32;  // GPIO0–31 in the first register of each pair, 32–39 in the second
  const uint32_t bit = 1u << (low ? pin : pin - 32);
  const bool enabled = (low ? en : en1) & bit;
  const bool level = (low ? out : out1) & bit;
  const bool input = (low ? in : in1) & bit;
  const uint32_t mux = REG_READ(GPIO_PIN_MUX_REG[pin]);
  const char pull = (mux & FUN_PU) ? 'u' : (mux & FUN_PD) ? 'd' : '-';
  if (perimanGetPinBusType(pin) == ESP32_BUS_TYPE_LEDC) {
    auto *ch = static_cast<ledc_channel_handle_t *>(perimanGetPinBus(pin, ESP32_BUS_TYPE_LEDC));
    if (ch) {
      snprintf(buf, len, "P%lu/%lu@%lu%c%d", (unsigned long)ledcRead(pin), (unsigned long)((1ul << ch->channel_resolution) - 1),
               (unsigned long)ch->freq_hz, pull, input);
      return;
    }
  }
  char state = 'Z';
  if (pin < 34 && enabled) {
    const uint32_t sel = REG_READ(GPIO_FUNC0_OUT_SEL_CFG_REG + 4 * pin) & 0x1FF;
    state = sel == SIMPLE_GPIO ? (level ? 'H' : 'L') : 'X';
  }
  snprintf(buf, len, "%c%c%d", state, pull, input);
}

void probe(void *) {
  static char line[N * 32 + 8];
  Serial.write("\x1eH esp32lab-probe 1\n");
  uint32_t lastFull = 0;
  for (;;) {
    const uint32_t out = REG_READ(GPIO_OUT_REG), out1 = REG_READ(GPIO_OUT1_REG);
    const uint32_t en = REG_READ(GPIO_ENABLE_REG), en1 = REG_READ(GPIO_ENABLE1_REG);
    const uint32_t in = REG_READ(GPIO_IN_REG), in1 = REG_READ(GPIO_IN1_REG);
    const uint32_t now = millis();
    const bool full = now - lastFull >= FULL_MS;
    if (full) lastFull = now;
    size_t at = 0;
    line[at++] = '\x1e';
    line[at++] = 'L';
    for (size_t i = 0; i < N; i++) {
      char s[24];
      describe(PINS[i], out, out1, en, en1, in, in1, s, sizeof s);
      if (!full && strcmp(s, last[i]) == 0) continue;
      strcpy(last[i], s);
      at += snprintf(line + at, sizeof line - at, " %u:%s", PINS[i], s);
    }
    if (at > 2) {
      line[at++] = '\n';
      Serial.write(reinterpret_cast<const uint8_t *>(line), at);
    }
    vTaskDelay(pdMS_TO_TICKS(POLL_MS));
  }
}

}  // namespace

// Arduino calls this before setup(): Serial up for the lab, and the probe started
void initVariant() {
  Serial.begin(115200);
  xTaskCreatePinnedToCore(probe, "esp32lab-probe", 4096, nullptr, 1, nullptr, 0);
}
`;
