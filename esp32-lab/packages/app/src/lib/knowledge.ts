// What the lab knows that is not on the bench, as text for the AI assistant: the parts' learn
// cards and specs, what each board pin is safe for, the featured projects, the lesson's steps and
// the libraries a sketch can include. Everything is read from the catalog, so a new part, board
// or project is known to the assistant without touching this file.

import type { PartProps, PropSchema } from '@esp32lab/part-sdk';
import type { BoardDef, Project } from '@esp32lab/project-model';
import libraries from '../../../lab-server/libraries.json';
import { CATEGORY, FEATURED, LESSONS, PARTS } from './catalog';
import { pinInfo, type Verdict } from './pinout';

const VERDICT: Record<Verdict, string> = { ok: 'dùng tự do', care: 'dùng được nhưng cẩn thận', avoid: 'không nên dùng', supply: 'chân nguồn' };

const num = (x: number) => String(x).replace('.', ',');

function prop(name: string, s: PropSchema): string {
  if (s.type === 'enum') return `${name}: một trong ${s.options.join(' | ')} (mặc định ${s.default})`;
  if (s.type === 'boolean') return `${name}: đúng/sai (mặc định ${s.default})`;
  const unit = s.unit ?? '';
  const range = s.options ? `một trong ${s.options.map(num).join(', ')}` : s.min !== undefined && s.max !== undefined ? `${num(s.min)}–${num(s.max)}` : '';
  return `${name}: số${range ? ` ${range}` : ''}${unit} (mặc định ${num(s.default)}${unit})`;
}

/** Every part type, one line each, for "what could I build with…". */
export function partCatalog(): string {
  const out = ['Linh kiện có trong lab (loại: tên, nhóm [các chân] — tóm tắt):'];
  for (const [type, m] of Object.entries(PARTS)) {
    const summary = m.manifest.learn?.summary;
    const pins = m.manifest.terminals.map((t) => t.name).join(', ');
    out.push(`- ${type}: ${m.manifest.name}, ${CATEGORY[m.manifest.category] ?? m.manifest.category} [${pins}]${summary ? ` — ${summary}` : ''}`);
  }
  return out.join('\n');
}

/** One part type in full: learn card, pins, props, ratings, specs for `props` (defaults if none). */
export function partInfo(type: string, props?: PartProps): string | null {
  const m = PARTS[type];
  if (!m) return null;
  const manifest = m.manifest;
  const out = [`${type}: ${manifest.name} (${CATEGORY[manifest.category] ?? manifest.category})`];
  if (manifest.learn) {
    out.push('', manifest.learn.summary, '', 'Cách nối:', ...manifest.learn.howToPlug.map((s) => `- ${s}`));
    if (manifest.learn.tips?.length) out.push('', 'Lưu ý:', ...manifest.learn.tips.map((s) => `- ${s}`));
  }
  out.push('', 'Chân:', ...manifest.terminals.map((t) => `- ${t.name}${t.label && t.label !== t.name ? ` (${t.label})` : ''}`));
  if (manifest.plug) {
    const pins = Object.entries(manifest.plug.pins).map(([t, role]) => `${t} → ${role}`);
    const series = Object.entries(manifest.plug.series ?? {}).map(([t, r]) => `điện trở nối tiếp ${num(r)} Ω ở ${t}`);
    const pull = Object.entries(manifest.plug.pull ?? {}).map(([t, [to, r]]) => `điện trở ${num(r)} Ω từ ${t} lên ${to}`);
    out.push('', `Cách nối thường dùng: ${[...pins, ...series, ...pull].join('; ')}`);
  }
  const propNames = Object.entries(manifest.props);
  if (propNames.length) out.push('', 'Thông số chỉnh được:', ...propNames.map(([k, s]) => `- ${prop(k, s)}`));
  const r = manifest.ratings;
  if (r) {
    const limits = [
      r.currentMax !== undefined && `dòng tối đa ${num(r.currentMax * 1000)} mA`,
      r.currentAbsMax !== undefined && `cháy ngay trên ${num(r.currentAbsMax * 1000)} mA`,
      r.reverseVoltageMax !== undefined && `áp ngược tối đa ${num(r.reverseVoltageMax)} V`,
      r.powerMax !== undefined && `công suất tối đa ${num(r.powerMax)} W`,
    ].filter(Boolean);
    if (limits.length) out.push('', `Giới hạn: ${limits.join(', ')}`);
  }
  if (m.doc) {
    const defaults = Object.fromEntries(propNames.map(([k, s]) => [k, s.default]));
    const specs = m.doc.specs({ ...defaults, ...props } as never);
    if (specs.length) out.push('', 'Số liệu:', ...specs.map(([k, v]) => `- ${k}: ${v}`));
  }
  const used = FEATURED.filter((f) => f.project.parts.some((p) => p.type === type)).map((f) => f.id);
  if (used.length) out.push('', `Dự án mẫu có dùng: ${used.join(', ')}`);
  return out.join('\n');
}

/** A header pin by its silkscreen label ("D4") or its GPIO ("GPIO4", "4"). */
export function pinText(board: BoardDef, name: string): string | null {
  const want = name.trim().toUpperCase();
  const gpio = /^(GPIO)?(\d+)$/.exec(want);
  const pin = board.pins.find((p) => p.name.toUpperCase() === want) ?? (gpio ? board.pins.find((p) => 'pad' in p.connect && p.connect.pad === `GPIO${gpio[2]}`) : undefined);
  if (!pin) return null;
  const info = pinInfo(board, pin);
  const tags = info.tags.map((t) => t.text).join(', ');
  return `${pin.name}${info.gpio !== undefined && pin.name !== `GPIO${info.gpio}` ? ` (GPIO${info.gpio})` : ''}: ${VERDICT[info.verdict]}. ${tags ? `Chức năng: ${tags}. ` : ''}${info.note}`;
}

/** Every header pin of the board, one line each. */
export function boardPins(board: BoardDef): string {
  return [`Các chân của ${board.name}:`, ...board.pins.map((p) => `- ${pinText(board, p.name)}`)].join('\n');
}

export function projectCatalog(): string {
  return ['Dự án mẫu (id: tên — tóm tắt):', ...FEATURED.map((f) => `- ${f.id}: ${f.title} — ${f.summary}`)].join('\n');
}

function partsOf(project: Project): string[] {
  return project.parts.map((p) => `- ${p.id}: ${PARTS[p.type]?.manifest.name ?? p.type}${p.props && Object.keys(p.props).length ? ` ${JSON.stringify(p.props)}` : ''}`);
}

/** A featured project: what it does, its parts, what to try, its main.cpp (it builds and runs). */
export function projectInfo(id: string): string | null {
  const f = FEATURED.find((x) => x.id === id);
  if (!f) return null;
  return [
    `${f.title} (${f.id})`,
    '',
    f.summary,
    '',
    'Linh kiện:',
    ...partsOf(f.project),
    '',
    'Thử:',
    ...f.tryIt.map((s) => `- ${s}`),
    '',
    'main.cpp (đã build và chạy được trong lab):',
    f.code,
  ].join('\n');
}

/** The lesson's goal and every step with what is checked and its hint; `passed` marks the done ones. */
export function lessonInfo(id: string, passed: (step: string) => boolean): string | null {
  const l = LESSONS.find((x) => x.id === id);
  if (!l) return null;
  const out = [`Bài học: ${l.titleVi ?? l.title}`];
  if (l.summary) out.push('', l.summary);
  out.push('', 'Các bước (bài đạt khi mọi kiểm tra của bước đều đúng):');
  const step = (s: (typeof l.steps)[number], prefix = '') => {
    out.push(`- ${prefix}[${passed(s.id) ? 'đã đạt' : 'chưa đạt'}] ${s.title}`);
    for (const c of s.checks) out.push(`    kiểm tra: ${JSON.stringify(c)}`);
    if (s.hint) out.push(`    gợi ý của bài: ${s.hint}`);
  };
  for (const s of l.steps) step(s);
  if (l.exercises?.length) {
    out.push('', 'Bài tập thêm:');
    for (const s of l.exercises) step(s, 'bài tập ');
  }
  out.push('', `Lý thuyết của bài nằm trong ${l.source}.`);
  return out.join('\n');
}

/** Headers a sketch can include beyond the Arduino core: the build adds their library by itself. */
export function libraryList(): string {
  return [
    'Thư viện ngoài lõi Arduino ESP32 mà build tự thêm khi code #include header tương ứng:',
    ...Object.entries(libraries as Record<string, string>).map(([h, lib]) => `- #include <${h}>  (${lib})`),
    'Header khác không có trong lõi Arduino ESP32 sẽ không build được.',
  ].join('\n');
}

/** What matters about the bench beyond its wiring: the tips of each part type on it, the board pins in use. */
export function benchKnowledge(project: Project, board: BoardDef | undefined, pinsInUse: string[]): string[] {
  const out: string[] = [];
  const types = [...new Set(project.parts.map((p) => p.type))];
  const tips = types.flatMap((t) => (PARTS[t]?.manifest.learn?.tips ?? []).map((s) => `- ${t}: ${s}`));
  if (tips.length) out.push('', 'Lưu ý về các loại linh kiện trên bàn (get_part để xem đủ):', ...tips);
  if (board) {
    const pins = pinsInUse.map((n) => pinText(board, n)).filter((s): s is string => !!s);
    if (pins.length) out.push('', 'Chân board đang dùng:', ...pins.map((s) => `- ${s}`));
  }
  return out;
}
