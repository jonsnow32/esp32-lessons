// SSD1306 OLED driver as seen over I2C: after the address, each control byte says whether what
// follows is commands (D/C = 0) or display data (D/C = 1), for one byte (Co = 1) or the rest of
// the transfer (Co = 0). Data bytes land in GDDRAM, 8 pages of 128 columns, one byte = 8 rows.

export const WIDTH = 128;
export const HEIGHT = 64;

/** How many argument bytes follow each command that takes any. */
const ARGS: Record<number, number> = {
  0x20: 1, 0x21: 2, 0x22: 2, 0x26: 6, 0x27: 6, 0x29: 5, 0x2a: 5, 0x81: 1, 0x8d: 1, 0xa3: 2,
  0xa8: 1, 0xd3: 1, 0xd5: 1, 0xd9: 1, 0xda: 1, 0xdb: 1,
};

export class Ssd1306 {
  readonly ram = new Uint8Array(8 * WIDTH);
  displayOn = false;
  chargePump = false;
  inverted = false;
  allOn = false;
  contrast = 0x7f;
  /** SEG remap (A1) and COM scan direction decreasing (C8): together, the usual upright image. */
  segRemap = false;
  comReverse = false;
  startLine = 0;
  /** 0 horizontal, 1 vertical, 2 page addressing. */
  mode = 2;
  colStart = 0;
  colEnd = WIDTH - 1;
  pageStart = 0;
  pageEnd = 7;
  col = 0;
  page = 0;

  // Transfer state
  private expectControl = true;
  private data = false;
  private single = false;
  private cmd: number[] = [];

  /**
   * A START addressed to the chip: the next byte is a control byte. A command waiting for its
   * arguments keeps waiting (libraries send 0x81 and the contrast in separate transfers).
   */
  begin(): void {
    this.expectControl = true;
  }

  write(byte: number): void {
    if (this.expectControl) {
      this.single = (byte & 0x80) !== 0;
      this.data = (byte & 0x40) !== 0;
      this.expectControl = false;
      return;
    }
    if (this.data) this.writeData(byte);
    else this.command(byte);
    if (this.single) this.expectControl = true;
  }

  private writeData(byte: number): void {
    this.ram[this.page * WIDTH + this.col] = byte;
    if (this.mode === 1) {
      if (++this.page > this.pageEnd) {
        this.page = this.pageStart;
        if (++this.col > this.colEnd) this.col = this.colStart;
      }
    } else if (++this.col > this.colEnd) {
      this.col = this.colStart;
      if (this.mode === 0 && ++this.page > this.pageEnd) this.page = this.pageStart;
    }
  }

  private command(byte: number): void {
    this.cmd.push(byte);
    const op = this.cmd[0]!;
    if (this.cmd.length <= (ARGS[op] ?? 0)) return;
    const [, a = 0, b = 0] = this.cmd;
    this.cmd = [];
    if (op <= 0x0f) this.col = (this.col & 0xf0) | op;
    else if (op <= 0x1f) this.col = ((op & 0x0f) << 4) | (this.col & 0x0f);
    else if (op === 0x20) this.mode = a & 3;
    else if (op === 0x21) [this.colStart, this.colEnd, this.col] = [a & 0x7f, b & 0x7f, a & 0x7f];
    else if (op === 0x22) [this.pageStart, this.pageEnd, this.page] = [a & 7, b & 7, a & 7];
    else if (op >= 0x40 && op <= 0x7f) this.startLine = op & 0x3f;
    else if (op === 0x81) this.contrast = a;
    else if (op === 0x8d) this.chargePump = (a & 0x04) !== 0;
    else if (op === 0xa0 || op === 0xa1) this.segRemap = op === 0xa1;
    else if (op === 0xa4 || op === 0xa5) this.allOn = op === 0xa5;
    else if (op === 0xa6 || op === 0xa7) this.inverted = op === 0xa7;
    else if (op === 0xae || op === 0xaf) this.displayOn = op === 0xaf;
    else if (op >= 0xb0 && op <= 0xb7) this.page = op & 7;
    else if (op === 0xc0 || op === 0xc8) this.comReverse = op === 0xc8;
    // Everything else (clock, multiplex, offset, pre-charge, COM pins, VCOMH, scrolling) is accepted
  }

  /** Whether the pixel at screen position (x, y), top-left origin, is lit. */
  pixel(x: number, y: number): boolean {
    if (!this.displayOn || !this.chargePump) return false;
    if (this.allOn) return true;
    const col = this.segRemap ? x : WIDTH - 1 - x;
    const row = ((this.comReverse ? y : HEIGHT - 1 - y) + this.startLine) % HEIGHT;
    const on = ((this.ram[(row >> 3) * WIDTH + col]! >> (row & 7)) & 1) === 1;
    return on !== this.inverted;
  }

  /** The screen as 1-bit rows, 16 bytes each, MSB = leftmost pixel. */
  frame(): Uint8Array {
    const out = new Uint8Array((WIDTH / 8) * HEIGHT);
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) if (this.pixel(x, y)) out[y * 16 + (x >> 3)]! |= 0x80 >> (x & 7);
    }
    return out;
  }
}
