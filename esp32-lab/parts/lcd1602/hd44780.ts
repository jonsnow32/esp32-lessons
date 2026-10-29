// HD44780 LCD controller behind a PCF8574 I/O expander, as on the usual "I2C backpack": the
// expander's pins P0 = RS, P1 = RW, P2 = E, P3 = backlight, P4–P7 = D4–D7. The controller
// latches D4–D7 on each falling edge of E, starting in 8-bit mode until a function set with
// DL = 0 switches it to 4-bit, after which two nibbles (high first) make one byte.

const RS = 0x01;
const RW = 0x02;
const E = 0x04;
const BACKLIGHT = 0x08;

export class Hd44780 {
  /** Display data RAM: line 1 at 0x00–0x27, line 2 at 0x40–0x67. */
  readonly ddram = new Uint8Array(0x80).fill(0x20);
  /** Character generator RAM: 8 custom characters × 8 rows, 5 bits each. */
  readonly cgram = new Uint8Array(64);
  /** Address counter, in DDRAM or CGRAM depending on the last address set. */
  ac = 0;
  toCgram = false;
  increment = true;
  shiftOnWrite = false;
  displayOn = false;
  cursor = false;
  blink = false;
  /** Display shift, in characters. */
  shift = 0;
  fourBit = false;
  twoLines = false;
  nibble: number | null = null;
  /** PCF8574 output latch. Powers up HIGH (weak pull-ups). */
  port = 0xff;

  get backlight(): boolean {
    return (this.port & BACKLIGHT) !== 0;
  }

  /** A byte written to the PCF8574: new pin levels; a falling E clocks the data pins in. */
  writePort(value: number): void {
    const fell = (this.port & E) !== 0 && (value & E) === 0;
    this.port = value;
    if (!fell || value & RW) return;
    const bits = value >> 4;
    const rs = (value & RS) !== 0;
    if (!this.fourBit) {
      // 8-bit mode with only D4–D7 wired: D0–D3 read as 0
      this.execute(bits << 4, rs);
    } else if (this.nibble === null) {
      this.nibble = bits;
    } else {
      const byte = (this.nibble << 4) | bits;
      this.nibble = null;
      this.execute(byte, rs);
    }
  }

  private step(addr: number, dir: number): number {
    if (!this.twoLines) return (addr + dir + 80) % 80;
    const next = addr + dir;
    if (dir > 0) return addr === 0x27 ? 0x40 : addr === 0x67 ? 0x00 : next;
    return addr === 0x40 ? 0x27 : addr === 0x00 ? 0x67 : next;
  }

  private execute(byte: number, data: boolean): void {
    const dir = this.increment ? 1 : -1;
    if (data) {
      if (this.toCgram) {
        this.cgram[this.ac & 0x3f] = byte & 0x1f;
        this.ac = (this.ac + dir) & 0x3f;
      } else {
        this.ddram[this.ac & 0x7f] = byte;
        this.ac = this.step(this.ac, dir);
        if (this.shiftOnWrite) this.shift += dir;
      }
      return;
    }
    if (byte & 0x80) {
      this.ac = byte & 0x7f;
      this.toCgram = false;
    } else if (byte & 0x40) {
      this.ac = byte & 0x3f;
      this.toCgram = true;
    } else if (byte & 0x20) {
      this.fourBit = (byte & 0x10) === 0;
      this.twoLines = (byte & 0x08) !== 0;
      this.nibble = null;
    } else if (byte & 0x10) {
      const right = (byte & 0x04) !== 0;
      if (byte & 0x08) this.shift += right ? -1 : 1;
      else this.ac = this.step(this.ac, right ? 1 : -1);
    } else if (byte & 0x08) {
      this.displayOn = (byte & 0x04) !== 0;
      this.cursor = (byte & 0x02) !== 0;
      this.blink = (byte & 0x01) !== 0;
    } else if (byte & 0x04) {
      this.increment = (byte & 0x02) !== 0;
      this.shiftOnWrite = (byte & 0x01) !== 0;
    } else if (byte & 0x02) {
      this.ac = 0;
      this.shift = 0;
      this.toCgram = false;
    } else if (byte & 0x01) {
      this.ddram.fill(0x20);
      this.ac = 0;
      this.shift = 0;
      this.increment = true;
      this.toCgram = false;
    }
  }

  /** Character code shown at row / column of a 16 × 2 display. */
  cell(row: number, col: number): number {
    const pos = (((col + this.shift) % 40) + 40) % 40;
    return this.ddram[(this.twoLines ? row * 0x40 : row * 40) + pos]!;
  }

  /** Visible row / column of the cursor, if on screen. */
  cursorCell(): [number, number] | null {
    if (this.toCgram) return null;
    const row = this.twoLines && this.ac >= 0x40 ? 1 : 0;
    const col = ((((this.ac & 0x3f) - this.shift) % 40) + 40) % 40;
    return col < 16 ? [row, col] : null;
  }
}
