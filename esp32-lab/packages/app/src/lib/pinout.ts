// What each header pin of an ESP32 board can do, for the board's detail page: function tags
// from the pad capability table, how safe the pin is for a beginner, and a Vietnamese note.

import { ESP32_PADS } from '@esp32lab/mcu-esp32';
import type { BoardDef, BoardPin } from '@esp32lab/project-model';

export type PinCategory = 'power' | 'gnd' | 'gpio' | 'adc1' | 'adc2' | 'touch' | 'dac' | 'uart' | 'input' | 'strap' | 'flash' | 'reset' | 'onboard';

export const CATEGORIES: Record<PinCategory, { label: string; bg: string; fg: string; hint: string }> = {
  power: { label: 'Nguồn', bg: '#e5484d', fg: '#fff', hint: 'Cấp điện: 3,3 V từ ổn áp hoặc 5 V từ USB' },
  gnd: { label: 'GND', bg: '#15191d', fg: '#fff', hint: 'Mass, 0 V' },
  gpio: { label: 'GPIO', bg: '#e4e7e6', fg: '#15191d', hint: 'Số GPIO dùng trong code' },
  adc1: { label: 'ADC1', bg: '#30a46c', fg: '#fff', hint: 'Đọc analog, dùng được cả khi bật Wi-Fi' },
  adc2: { label: 'ADC2', bg: '#9bd1ae', fg: '#15191d', hint: 'Đọc analog, nhưng không dùng được khi bật Wi-Fi' },
  touch: { label: 'Touch', bg: '#8e4ec6', fg: '#fff', hint: 'Cảm ứng chạm (touchRead)' },
  dac: { label: 'DAC', bg: '#d4a106', fg: '#fff', hint: 'Xuất điện áp analog thật (dacWrite)' },
  uart: { label: 'UART', bg: '#3e63dd', fg: '#fff', hint: 'Cổng Serial' },
  input: { label: 'Chỉ vào', bg: '#fff', fg: '#c4500a', hint: 'Chỉ đọc vào, không xuất ra, không có điện trở kéo trong' },
  strap: { label: 'Khởi động', bg: '#f5a524', fg: '#15191d', hint: 'Chân strapping: mức của nó lúc reset quyết định cách chip khởi động' },
  flash: { label: 'Flash', bg: '#b8232b', fg: '#fff', hint: 'Nối với bộ nhớ flash trong module: không được dùng' },
  reset: { label: 'Reset', bg: '#626b74', fg: '#fff', hint: 'EN: kéo xuống LOW để khởi động lại chip' },
  onboard: { label: 'Trên board', bg: '#12a594', fg: '#fff', hint: 'Đã nối sẵn với LED hoặc nút trên board' },
};

/** ✓ free to use, ⚠ works with a catch, ✗ leave alone. */
export type Verdict = 'ok' | 'care' | 'avoid' | 'supply';

export interface PinInfo {
  pin: BoardPin;
  gpio?: number;
  tags: { cat: PinCategory; text: string }[];
  verdict: Verdict;
  note: string;
}

const STRAP_NOTE: Record<number, string> = {
  0: 'Giữ LOW lúc reset là vào chế độ nạp code (nút BOOT). Dùng làm nút nhấn được.',
  2: 'Phải LOW hoặc để hở lúc nạp code. Thường nối LED trên board.',
  5: 'Phát vài xung lúc khởi động; dùng làm ngõ ra được, nhưng đừng nối thiết bị nhạy.',
  12: 'Nếu ở HIGH lúc reset, chip chọn sai điện áp flash và không chạy. Tránh kéo lên.',
  15: 'Ở LOW lúc reset thì tắt log khởi động. Dùng được, cẩn thận với điện trở kéo xuống.',
};
const UART: Record<number, string> = { 1: 'TX0', 3: 'RX0', 16: 'RX2', 17: 'TX2' };

/** The onboard part (LED, button) a pad is wired to, by its label. */
function onboardAt(board: BoardDef, pad: string): string | undefined {
  for (const op of board.onboard) {
    const touches = Object.values(op.connect).some((c) => 'pad' in c && c.pad === pad);
    if (touches && op.type === 'pushbutton') return op.label?.split(' ')[0];
    // The LED hangs off a resistor that sits on the pad
    if (touches && op.type === 'resistor') {
      const node = Object.values(op.connect).find((c) => 'node' in c);
      const led = node && board.onboard.find((o) => o.type === 'led' && Object.values(o.connect).some((c) => 'node' in c && c.node === (node as { node: string }).node));
      if (led) return 'LED';
    }
  }
  return undefined;
}

export function pinInfo(board: BoardDef, pin: BoardPin): PinInfo {
  const c = pin.connect;
  if ('net' in c) {
    if (c.net === 'GND') return { pin, tags: [{ cat: 'gnd', text: 'GND' }], verdict: 'supply', note: 'Mass chung, nối cực âm của mọi linh kiện về đây.' };
    const supply = board.supplies.find((s) => s.net === c.net);
    const note = c.net === '5V' ? 'Nối thẳng với 5 V của cổng USB. Cấp cho module 5 V (cảm biến siêu âm, PIR).' : 'Ra từ ổn áp 3,3 V. Nguồn cho hầu hết cảm biến và linh kiện.';
    return { pin, tags: [{ cat: 'power', text: supply ? `${String(supply.volts).replace('.', ',')} V` : c.net }], verdict: 'supply', note };
  }
  if (!('pad' in c)) return { pin, tags: [], verdict: 'avoid', note: '' };
  if (c.pad === 'EN') return { pin, tags: [{ cat: 'reset', text: 'RESET' }], verdict: 'avoid', note: 'Chân bật chip: kéo xuống LOW để khởi động lại (nút EN).' };

  const gpio = Number(c.pad.replace('GPIO', ''));
  const cap = ESP32_PADS[c.pad];
  const tags: PinInfo['tags'] = [{ cat: 'gpio', text: `GPIO${gpio}` }];
  const onboard = onboardAt(board, c.pad);
  if (onboard) tags.push({ cat: 'onboard', text: onboard });
  if (cap?.adc) tags.push({ cat: cap.adcBlockedByWifi ? 'adc2' : 'adc1', text: cap.adc.replace('_CH', '_') });
  if (cap?.touch) tags.push({ cat: 'touch', text: cap.touch });
  if (cap?.dac) tags.push({ cat: 'dac', text: cap.dac });
  if (UART[gpio]) tags.push({ cat: 'uart', text: UART[gpio]! });
  if (cap?.inputOnly) tags.push({ cat: 'input', text: 'chỉ vào' });
  if (cap?.strapping) tags.push({ cat: 'strap', text: 'khởi động' });
  if (cap?.flash) tags.push({ cat: 'flash', text: 'flash' });

  let verdict: Verdict = 'ok';
  let note = cap?.adc && !cap.adcBlockedByWifi ? 'Dùng tự do: số, PWM và đọc analog (ADC1).' : 'Dùng tự do cho ngõ vào, ngõ ra và PWM.';
  if (cap?.flash) [verdict, note] = ['avoid', 'Nối với bộ nhớ flash trong module. Nối vào đây sẽ làm board treo.'];
  else if (gpio === 1 || gpio === 3) [verdict, note] = ['avoid', 'Serial qua USB (nạp code, Serial Monitor). Nối linh kiện vào sẽ hỏng việc nạp và in log.'];
  else if (cap?.strapping) [verdict, note] = ['care', STRAP_NOTE[gpio] ?? 'Chân khởi động: cẩn thận với mức của nó lúc reset.'];
  else if (cap?.inputOnly) [verdict, note] = ['care', 'Chỉ đọc vào được (nút, cảm biến analog). Không có điện trở kéo trong: cần điện trở ngoài.'];
  else if (cap?.adcBlockedByWifi) note = 'Dùng tự do; riêng đọc analog (ADC2) không hoạt động khi bật Wi-Fi.';
  return { pin, gpio, tags, verdict, note };
}
