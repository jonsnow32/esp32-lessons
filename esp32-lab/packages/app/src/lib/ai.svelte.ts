// "Trợ lý AI": a chat with Claude about the circuit and the code on the bench. The user brings
// their own Anthropic API key; it stays in this browser (never in the settings object, which may
// be synced with a profile later) and the requests go straight from here to the API.
//
// Claude reads the bench through tools: the netlist with live voltages, the explanation notes,
// the code with its build errors, the serial output. What the lab knows beyond the bench (the
// parts' learn cards, the board pins, the featured projects, the lesson) it looks up the same way.
// It never edits anything by itself: new code and new parts and wires come back as proposals the
// user applies, and highlighting is the only thing it does on the bench. A circuit proposal is
// checked part by part first (verify.ts); one with errors goes back to Claude to fix, a few times,
// before the user sees it.
//
// Where the lab's server offers it (the dev server, the desktop app when turned on there) there is
// a second way in: the Claude Code CLI on this machine, on the user's own Claude login (see
// lab-server/src/claude-cli.ts). It cannot call the tools, so each question carries a snapshot of
// the bench and proposals come back as tagged text.

import Anthropic from '@anthropic-ai/sdk';
import type * as Beta from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { PartProps } from '@esp32lab/part-sdk';
import type { BoardDef, Project } from '@esp32lab/project-model';
import { keyOf } from '@esp32lab/sim-core';
import type { CircuitChange } from './autoplug';
import { BOARDS, PARTS } from './catalog';
import { benchKnowledge, boardPins, lessonInfo, libraryList, partCatalog, partInfo, pinText, projectCatalog, projectInfo } from './knowledge';
import { lab } from './lab.svelte';
import { verifyChange, type Finding } from './verify';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (giỏi nhất)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (nhanh, rẻ hơn)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (rẻ nhất)' },
] as const;
export type ModelId = (typeof MODELS)[number]['id'];

/** Where the answers come from: the Anthropic API with the user's key, or Claude Code (dev only). */
export type Source = 'api' | 'cli';
/**
 * Whether the lab's server can run Claude Code on this computer: null until it answers. Only the
 * dev server and the desktop app (when turned on there) can; a web build answers with its page.
 */
export const cli = $state<{ available: boolean | null }>({ available: null });
fetch('/api/ai/claude')
  .then((r) => r.json())
  .then((r: { available?: unknown }) => (cli.available = r.available === true))
  .catch(() => (cli.available = false));

interface AiConfig {
  apiKey: string;
  model: ModelId;
  source: Source;
}

const KEY = 'esp32lab.ai';

function loadConfig(): AiConfig {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AiConfig> | null;
    const model = MODELS.some((m) => m.id === stored?.model) ? stored!.model! : 'claude-opus-5-5';
    return { apiKey: stored?.apiKey ?? '', model, source: stored?.source === 'cli' ? 'cli' : 'api' };
  } catch {
    return { apiKey: '', model: 'claude-opus-5-5', source: 'api' };
  }
}

/** What the chat shows: the user's and Claude's words, what Claude looked at, its code proposals. */
export type Entry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; text: string }
  | { kind: 'code'; summary: string; code: string; applied: boolean }
  /** New parts and wires, planned on the bench as it was (`base`), with what the plan does and what the check found. */
  | { kind: 'circuit'; summary: string; change: CircuitChange; report: string[]; check?: Finding[]; base: string; project: Project; applied: boolean }
  | { kind: 'error'; text: string };

/** Proposals with errors sent back to Claude in one question before the next is shown as it is. */
const FIXES = 2;

const ABOUT = `Bạn là trợ lý trong ESP32 Lab, một phòng thí nghiệm mô phỏng cho người mới học điện tử và lập trình ESP32 (Arduino framework, PlatformIO). Trên bàn có một board ESP32 DevKit, breadboard, linh kiện và dây nối; code Arduino trong editor được build bằng PlatformIO thật và chạy trên một trình giả lập ESP32, mạch điện được giải bằng phân tích nút (MNA) nên điện áp và dòng điện là số đo thật của mô phỏng.

Cách làm việc:
- Trả lời bằng tiếng Việt, ngắn gọn, dễ hiểu cho người mới. Dùng dấu phẩy thập phân (3,3 V).
%RULES%
- Chú ý các lỗi hay gặp của người mới: LED không có điện trở hạn dòng, nối ngược cực, dùng chân board không hợp (xem đánh giá của chân), quên pinMode, nút nhấn không có điện trở kéo.
- Nếu đang làm bài học, hãy dẫn dắt: gợi ý từng bước, đặt câu hỏi để người học tự tìm ra lỗi. Chỉ đưa lời giải đầy đủ khi người dùng yêu cầu rõ ràng.`;

const SYSTEM = ABOUT.replace('%RULES%', `- Trước khi nói về mạch, code hay lỗi, hãy xem bằng công cụ (get_circuit, get_code, get_serial). Đừng đoán số đo: chỉ nêu điện áp, dòng điện có trong dữ liệu công cụ trả về.
- Kiến thức của lab đáng tin hơn trí nhớ của bạn: trước khi giải thích một linh kiện, chọn chân hay viết code, tra bằng get_part, get_pin, list_libraries; muốn viết code mới thì xem dự án mẫu gần nhất (list_projects, get_project) vì code đó đã chạy được trong lab. Đang làm bài học thì get_lesson cho biết từng bước kiểm tra gì.
- Khi nói tới linh kiện hay chân cụ thể, dùng highlight để tô sáng chúng trên bàn.
- Muốn thêm linh kiện hay dây vào mạch thì dùng propose_circuit (tra get_part trước để biết tên chân); người dùng sẽ tự bấm áp dụng. Sửa mạch đã có thì gỡ linh kiện (remove) hoặc ngắt dây ở chân sai (disconnect) rồi nối lại cho đúng, đừng nối thêm dây chồng lên dây cũ; không nối dây giữa hai chỗ đã cùng net. Nếu cũng cần đổi code, gọi propose_circuit trước rồi viết code theo đúng các chân board trong kết quả của nó.
- Bạn tự sửa được mạch đã có, đừng bảo người dùng tự xoá dây hay dời linh kiện: trong propose_circuit, remove gỡ linh kiện kèm dây của nó, disconnect ngắt hết dây ở một chân linh kiện hay chân board, dây không còn dẫn tới đâu được dọn theo; sau đó nối lại cho đúng. Linh kiện bị nối tắt vì cắm sai chỗ trên breadboard thì gỡ rồi thêm lại (giữ id cũ cũng được) để lab cắm sang chỗ khác. Những gì bạn nói trước đây rằng chỉ thêm được dây không còn đúng nữa.
- Trước khi gọi propose_circuit, tự rà từng linh kiện: mỗi chân nối đi đâu, nguồn và GND của module, LED có điện trở hạn dòng, đúng chiều cực, chân GPIO làm được việc đó (không phải chân chỉ vào hay chân flash), tải lớn như bơm, động cơ đi qua relay hoặc MOSFET. Thay linh kiện thì gỡ hẳn linh kiện cũ và những gì chỉ phục vụ nó, đừng để lại linh kiện thừa. Lab cũng kiểm tra lại từng linh kiện bằng mô phỏng: nếu propose_circuit báo lỗi thì đề xuất chưa hiện cho người dùng, hãy sửa đúng các lỗi đó rồi gọi lại propose_circuit với cả mạch đã sửa. Lưu ý (cảnh báo) thì nhắc người dùng nếu đáng kể.
- Muốn đổi code thì dùng propose_code với toàn bộ file main.cpp mới; người dùng sẽ tự bấm áp dụng. Không dán cả file code vào câu trả lời.`);

/** For Claude Code, which has no tools here: the bench comes with each question, actions go back as tags. */
const SYSTEM_CLI = ABOUT.replace('%RULES%', `- Mỗi câu hỏi kèm ảnh chụp bàn lúc hỏi: <circuit> (linh kiện, net và điện áp đo được, lưu ý về linh kiện và chân board đang dùng), <lesson> nếu đang làm bài học, <code> (main.cpp có số dòng, kết quả build), <serial>. Chỉ dựa vào ảnh chụp mới nhất. Đừng đoán số đo: chỉ nêu điện áp, dòng điện có trong đó.
- <libraries> là các thư viện build được; đừng dùng thư viện khác ngoài lõi Arduino ESP32.
- Khi nói tới linh kiện hay chân cụ thể, thêm một dòng <highlight>led1, led1.anode, board:D2</highlight> (id linh kiện, chân linh kiện hoặc chân board) để chúng được tô sáng trên bàn.
- Muốn thêm linh kiện hay dây vào mạch thì đặt một khối \`\`\`json circuit … \`\`\` chứa {"summary": "…", "parts": [{"id": "pump1", "type": "water-pump", "props": {}}], "wires": [{"from": "relay1.no", "to": "pump1.pos"}]}. Sửa mạch đã có thì thêm "remove": ["led1"] (gỡ linh kiện kèm dây và điện trở lab đã cắm cho nó) hoặc "disconnect": ["led1.anode", "board:D4"] (ngắt hết dây ở chân đó) rồi nối lại cho đúng, đừng nối thêm dây chồng lên dây cũ; không nối dây giữa hai chỗ đã cùng net. Mã loại và tên chân lấy từ <parts>. Đầu dây là chân linh kiện ("relay1.com", kể cả linh kiện vừa thêm) hoặc chân board ("board:VIN"). Chân nào của linh kiện mới chưa có dây thì lab tự cắm theo cách nối mẫu, nhưng bạn không biết nó chọn chân GPIO nào: chân tín hiệu mà code dùng phải ghi dây rõ tới chân board. Người dùng sẽ tự bấm áp dụng.
- Bạn tự sửa được mạch đã có, đừng bảo người dùng tự xoá dây hay dời linh kiện: trong khối json circuit, "remove" gỡ linh kiện kèm dây của nó, "disconnect" ngắt hết dây ở một chân linh kiện hay chân board, dây không còn dẫn tới đâu được dọn theo; sau đó nối lại cho đúng. Linh kiện bị nối tắt vì cắm sai chỗ trên breadboard thì gỡ rồi thêm lại (giữ id cũ cũng được) để lab cắm sang chỗ khác. Những gì bạn nói trước đây rằng chỉ thêm được dây không còn đúng nữa.
- Trước khi đặt khối json circuit, tự rà từng linh kiện: mỗi chân nối đi đâu, nguồn và GND của module, LED có điện trở hạn dòng, đúng chiều cực, chân GPIO làm được việc đó, tải lớn đi qua relay hoặc MOSFET. Lab kiểm tra lại từng linh kiện bằng mô phỏng; nếu có lỗi bạn sẽ nhận <check> với danh sách lỗi: khi đó gửi lại khối json circuit đã sửa đúng các lỗi đó (và khối cpp nếu code phải đổi theo).
- Muốn đổi code thì đặt toàn bộ main.cpp mới trong đúng một khối \`\`\`cpp main.cpp … \`\`\` ở cuối câu trả lời; người dùng sẽ tự bấm áp dụng. Ngoài khối đó không dán cả file code.`);

const TOOLS: Beta.BetaTool[] = [
  {
    name: 'get_circuit',
    description:
      'Mạch trên bàn: board, linh kiện (id, loại, thông số), các net nối với nhau (mỗi net là danh sách chân linh kiện và chân board cùng điện áp đo được nếu mô phỏng đang chạy), chân bỏ trống, chẩn đoán của mô phỏng, ghi chú giải thích mạch và trạng thái quan sát được của linh kiện (LED sáng bao nhiêu, servo góc mấy...).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_code',
    description: 'main.cpp trong editor (có đánh số dòng), kết quả build gần nhất kèm lỗi biên dịch, và board đang chạy chương trình nào.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_serial',
    description: 'Phần cuối của những gì chương trình in ra Serial (UART0, 115200 baud).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_parts',
    description: 'Mọi loại linh kiện có trong lab, mỗi loại một dòng: mã loại, tên, nhóm và tóm tắt. Dùng khi người dùng hỏi làm được gì, cần linh kiện nào.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_part',
    description:
      'Mọi điều lab biết về một loại linh kiện: giải thích cho người mới, cách nối, lưu ý, các chân, thông số chỉnh được và dải giá trị, giới hạn dòng/áp, số liệu kỹ thuật, dự án mẫu có dùng nó.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Mã loại linh kiện, ví dụ "led", "dht", "relay" (xem list_parts).' },
        props: { type: 'object', description: 'Thông số để tính số liệu, ví dụ {"color":"blue"}. Bỏ trống thì dùng mặc định.' },
      },
      required: ['type'],
    },
  },
  {
    name: 'get_pin',
    description:
      'Chân của board trên bàn: chức năng (ADC1/ADC2, touch, DAC, UART, chỉ vào, strapping, flash), có nên dùng không và vì sao. Bỏ trống name để xem mọi chân.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Nhãn trên board ("D4") hoặc số GPIO ("GPIO4", "4").' } },
    },
  },
  {
    name: 'list_projects',
    description: 'Các dự án mẫu của lab, mỗi dự án một dòng: id, tên, tóm tắt.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_project',
    description: 'Một dự án mẫu: nó làm gì, linh kiện, những điều nên thử và toàn bộ main.cpp (đã build và chạy được trong lab).',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'id dự án (xem list_projects).' } },
      required: ['id'],
    },
  },
  {
    name: 'get_lesson',
    description: 'Bài học đang mở: mục tiêu, từng bước với điều kiện kiểm tra, gợi ý của bài và bước nào đã đạt.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_libraries',
    description: 'Các thư viện build được (ngoài lõi Arduino ESP32) và header cần #include.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'highlight',
    description:
      'Tô sáng linh kiện hoặc chân trên bàn để người dùng thấy bạn đang nói tới đâu. Mỗi mục là id linh kiện ("led1"), chân linh kiện ("led1.anode") hoặc chân board ("board:D2"). Danh sách rỗng để bỏ tô sáng.',
    input_schema: {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'string' } } },
      required: ['items'],
    },
  },
  {
    name: 'propose_circuit',
    description:
      'Đề xuất sửa mạch trên bàn: gỡ linh kiện, ngắt dây sai, rồi thêm linh kiện và dây. Muốn sửa chỗ sai thì gỡ hoặc ngắt nó (remove, disconnect) rồi nối lại, đừng nối thêm dây chồng lên. Dây giữa hai chỗ đã thông nhau sẽ bị bỏ qua. Lab thử ráp ngay và trả về từng việc nó sẽ làm (linh kiện cắm ở đâu, chân nào nối chân board nào); người dùng xem rồi tự bấm áp dụng. Chân nào của linh kiện mới chưa có dây thì lab tự cắm theo cách nối mẫu (nguồn, GND, GPIO trống, điện trở hạn dòng, điện trở kéo). Chân tín hiệu mà code dùng thì nên ghi dây rõ tới chân board để khớp với code.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Một câu: thêm gì và để làm gì.' },
        remove: {
          type: 'array',
          description: 'id linh kiện đang có trên bàn cần gỡ đi, kèm dây nối vào nó. Điện trở lab đã cắm cho nó (hạn dòng, kéo) được gỡ theo, trừ khi wires nối lại điện trở đó.',
          items: { type: 'string' },
        },
        disconnect: {
          type: 'array',
          description: 'Chân linh kiện ("led1.anode") hoặc chân board ("board:D4") cần ngắt hết dây đang nối vào; dây còn lại không dẫn tới đâu cũng được dọn. Làm trước khi thêm dây mới.',
          items: { type: 'string' },
        },
        parts: {
          type: 'array',
          description: 'Linh kiện mới.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'id mới, chưa có trên bàn, ví dụ "pump1".' },
              type: { type: 'string', description: 'Mã loại linh kiện (xem list_parts).' },
              props: { type: 'object', description: 'Thông số, ví dụ {"color":"green"}. Bỏ trống thì dùng mặc định.' },
            },
            required: ['id', 'type'],
          },
        },
        wires: {
          type: 'array',
          description: 'Dây cần đi đúng chỗ. Mỗi đầu là chân linh kiện ("relay1.com", kể cả linh kiện vừa thêm) hoặc chân board ("board:VIN", "board:D23").',
          items: {
            type: 'object',
            properties: { from: { type: 'string' }, to: { type: 'string' } },
            required: ['from', 'to'],
          },
        },
      },
      required: ['summary', 'parts', 'wires'],
    },
  },
  {
    name: 'propose_code',
    description: 'Đề xuất một main.cpp mới. Người dùng xem và tự bấm áp dụng vào editor; code chưa được build cho tới khi họ bấm Chạy.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Một câu: đổi gì và vì sao.' },
        code: { type: 'string', description: 'Toàn bộ nội dung main.cpp mới.' },
      },
      required: ['summary', 'code'],
    },
  },
];

const num = (x: number) => String(Math.round(x * 1000) / 1000).replace('.', ',');

/** The bench as text Claude can read: parts, nets with voltages, loose terminals. */
function circuit(): string {
  const project = lab.project;
  const kernel = lab.netKernel;
  const board = BOARDS[project.board.type];
  const out: string[] = [`Board: ${board?.name ?? project.board.type}`];
  const pinsInUse: string[] = [];

  out.push('', 'Linh kiện:');
  if (!project.parts.length) out.push('(chưa có linh kiện nào)');
  for (const p of project.parts) {
    const manifest = PARTS[p.type]?.manifest;
    const props = p.props && Object.keys(p.props).length ? ` ${JSON.stringify(p.props)}` : '';
    const where = p.placement ? `cắm breadboard ${p.placement.bb} lỗ ${p.placement.hole}` : 'nằm ngoài breadboard';
    out.push(`- ${p.id}: ${manifest?.name ?? p.type}${props}, ${where}`);
  }

  if (kernel) {
    // Group every part terminal and board pin by the net it is on
    const nets = new Map<number, string[]>();
    const add = (key: string, label: string) => {
      const net = kernel.netlist.net(key);
      if (net === undefined) return;
      nets.set(net, [...(nets.get(net) ?? []), label]);
    };
    const keyOfLabel = new Map<string, string>();
    for (const p of project.parts) {
      for (const t of PARTS[p.type]?.manifest.terminals ?? []) {
        const key = keyOf.terminal(p.id, t.name);
        keyOfLabel.set(`${p.id}.${t.name}`, key);
        add(key, `${p.id}.${t.name}`);
      }
    }
    const partNets = new Set(nets.keys());
    for (const pin of board?.pins ?? []) {
      const key = keyOf.boardPin(pin.name);
      const net = kernel.netlist.net(key);
      if (net !== undefined && partNets.has(net)) {
        add(key, `board:${pin.name}`);
        pinsInUse.push(pin.name);
      }
    }
    const voltageOf = (members: string[]) => {
      for (const m of members) {
        const key = m.startsWith('board:') ? keyOf.boardPin(m.slice(6)) : keyOfLabel.get(m);
        const v = key ? lab.voltages[key] : undefined;
        if (v === null) return 'thả nổi';
        if (v !== undefined) return `${num(v)} V`;
      }
      return null;
    };
    const joined = [...nets.values()].filter((m) => m.length > 1);
    const loose = [...nets.values()].filter((m) => m.length === 1).flat();
    out.push('', `Các net (${lab.program.kind === 'none' ? 'chưa chạy mô phỏng nên không có điện áp' : 'điện áp đo lúc này'}):`);
    if (!joined.length) out.push('(không có chân nào nối với nhau)');
    for (const m of joined) {
      const v = voltageOf(m);
      out.push(`- ${m.join(', ')}${v ? `  [${v}]` : ''}`);
    }
    if (loose.length) out.push('', `Chân linh kiện chưa nối gì: ${loose.join(', ')}`);
  } else {
    out.push('', '(không dựng được netlist cho mạch này)');
  }

  if (lab.diagnostics.length) {
    out.push('', 'Chẩn đoán của mô phỏng:');
    for (const d of lab.diagnostics) out.push(`- [${d.severity}] ${d.part ? `${d.part}: ` : ''}${d.message}`);
  }
  if (lab.notes.length) {
    out.push('', 'Ghi chú "Mạch đang làm gì":');
    for (const n of lab.notes) out.push(`- [${n.level}] ${n.text}`);
  }
  const observed = Object.entries(lab.observables).filter(([, o]) => Object.keys(o).length);
  if (observed.length) {
    out.push('', 'Trạng thái linh kiện:');
    for (const [id, o] of observed) out.push(`- ${id}: ${JSON.stringify(o)}`);
  }
  out.push(...benchKnowledge(project, board, pinsInUse));
  return out.join('\n');
}

function code(): string {
  const lines = lab.code.split('\n').map((l, i) => `${String(i + 1).padStart(3)}| ${l}`);
  const b = lab.build;
  const out = ['main.cpp:', ...lines, ''];
  if (b.status === 'idle') out.push('Chưa build lần nào.');
  else if (b.status === 'building') out.push('Đang build.');
  else if (b.status === 'ok') out.push(`Build gần nhất thành công (${b.ms} ms).`);
  else {
    out.push('Build gần nhất thất bại.');
    for (const e of b.errors) out.push(`- dòng ${e.line}:${e.column} [${e.severity}] ${e.message}`);
    if (!b.errors.length) out.push('Cuối log build:', b.log.slice(-3000));
  }
  const p = lab.program;
  out.push(p.kind === 'none' ? 'Board chưa chạy chương trình nào.' : `Board đang ${lab.running ? 'chạy' : 'tạm dừng'} ${p.kind === 'sketch' ? 'code đã build từ editor' : `bản build sẵn ${p.env}`}${lab.codeChanged ? ', code trong editor đã sửa sau lần build đó' : ''}.`);
  if (lab.halted) out.push(`Chip đã dừng: ${lab.halted}`);
  return out.join('\n');
}

/** "led1", "led1.anode", "board:D2" → the ids and netlist keys the bench emphasises. */
function emphasis(items: string[]): string[] {
  return items.map((s) => {
    if (s.startsWith('board:')) return keyOf.boardPin(s.slice(6));
    const dot = s.indexOf('.');
    return dot < 0 ? s : keyOf.terminal(s.slice(0, dot), s.slice(dot + 1));
  });
}

/** The open lesson's steps, with the ones passed now or before marked. */
function lessonSteps(): string | null {
  const l = lab.lesson;
  return l ? lessonInfo(l.id, (id) => lab.steps.find((s) => s.id === id)?.pass ?? lab.passed.includes(id)) : null;
}

/** Where the user is, sent with each question: the tools tell the rest. */
function situation(): string {
  const lesson = lab.lesson;
  const out: string[] = [];
  if (lesson) {
    out.push(`Đang làm bài học: ${lesson.titleVi ?? lesson.title}.`);
    const todo = lab.steps.filter((s) => !s.pass);
    if (todo.length) out.push(`Bước chưa đạt: ${todo.map((s) => s.title).join('; ')}.`);
  } else if (lab.featured) out.push(`Đang xem dự án mẫu: ${lab.featured.title}.`);
  else if (lab.mine) out.push(`Dự án của người dùng: ${lab.mine.title}.`);
  else out.push('Bàn tự do.');
  return out.join(' ');
}

/** A circuit proposal as Claude sent it, checked for shape; a string says what is wrong. */
export function parseChange(input: Record<string, unknown>): { summary: string; change: CircuitChange } | string {
  const { summary, parts = [], wires = [], remove = [], disconnect = [] } = input;
  if (typeof summary !== 'string' || !Array.isArray(parts) || !Array.isArray(wires)) return 'Cần summary (chuỗi), parts và wires (danh sách).';
  if (!Array.isArray(remove) || !remove.every((x) => typeof x === 'string')) return 'remove phải là danh sách id linh kiện.';
  if (!Array.isArray(disconnect) || !disconnect.every((x) => typeof x === 'string')) return 'disconnect phải là danh sách chân ("led1.anode", "board:D4").';
  const change: CircuitChange = { parts: [], wires: [] };
  if (remove.length) change.remove = remove as string[];
  if (disconnect.length) change.disconnect = disconnect as string[];
  for (const p of parts as Record<string, unknown>[]) {
    if (typeof p?.id !== 'string' || typeof p.type !== 'string') return 'Mỗi linh kiện cần id và type là chuỗi.';
    const props = p.props && typeof p.props === 'object' ? (p.props as PartProps) : undefined;
    change.parts.push({ id: p.id, type: p.type, ...(props ? { props } : {}) });
  }
  for (const w of wires as Record<string, unknown>[]) {
    if (typeof w?.from !== 'string' || typeof w.to !== 'string') return 'Mỗi dây cần from và to là chuỗi.';
    change.wires.push([w.from, w.to]);
  }
  if (!change.parts.length && !change.wires.length && !remove.length && !disconnect.length) return 'Đề xuất trống: không có linh kiện hay dây nào.';
  return { summary, change };
}

/** A saved conversation as the history list shows it; its messages are stored apart. */
export interface ChatInfo {
  id: string;
  /** The bench it is about (lab.route): a lesson, a featured project, a project of the user's. */
  route: string;
  title: string;
  updated: number;
  source: Source;
}

interface ChatData {
  entries: Entry[];
  history: Beta.BetaMessageParam[];
  session: string | null;
  /** The instructions the Claude Code session started with (see fingerprint). */
  system?: string;
}

/** Short stand-in for a system prompt, to tell when it changed. */
function fingerprint(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const CHATS = 'esp32lab.ai.chats';
const chatKey = (id: string) => `esp32lab.ai.chat.${id}`;
/** Conversations kept per bench: the oldest goes when another starts. */
const PER_BENCH = 10;

function loadChats(): ChatInfo[] {
  try {
    const list = JSON.parse(localStorage.getItem(CHATS) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

class Assistant {
  private config = $state(loadConfig());
  /** Every saved conversation, newest first. */
  chats = $state<ChatInfo[]>([]);
  /** The conversation on screen, once it is saved. */
  chatId = $state<string | null>(null);
  /** The bench the conversation on screen is about. */
  private route = $state('');
  /** Which way in the conversation on screen started; it cannot go on the other way. */
  private chatSource: Source | null = null;
  /** Bumped when the conversation on screen changes, so a question still running stays out of it. */
  private turn = 0;
  entries = $state<Entry[]>([]);
  busy = $state(false);
  /** Claude is thinking or reading the bench, nothing written yet. */
  waiting = $state(false);
  private history: Beta.BetaMessageParam[] = [];
  /** The Claude Code conversation, to --resume. */
  private session: string | null = null;
  /** The instructions it started with: a session from older ones is not resumed. */
  private sessionSystem: string | undefined;
  private stream: { abort(): void } | null = null;
  /** Circuit proposals sent back to Claude to fix in the question running. */
  private fixes = 0;

  get apiKey() {
    return this.config.apiKey;
  }
  get model() {
    return this.config.model;
  }
  /** The way in chosen, or the API while Claude Code turns out not to be there. */
  get source(): Source {
    return this.config.source === 'cli' && cli.available === false ? 'api' : this.config.source;
  }
  /** There is a way to ask: a key for the API, or Claude Code. */
  get ready() {
    return this.source === 'cli' || !!this.config.apiKey;
  }

  constructor() {
    // Conversations about projects the user has since deleted go with them
    const all = loadChats();
    const kept = all.filter((c) => !c.route.startsWith('my-') || lab.myProjects.some((p) => p.id === c.route));
    for (const c of all) if (!kept.includes(c)) localStorage.removeItem(chatKey(c.id));
    this.chats = kept.sort((a, b) => b.updated - a.updated);
    if (kept.length !== all.length) this.saveIndex();
  }

  /** The saved conversations about the bench on screen, newest first. */
  get benchChats() {
    return this.chats.filter((c) => c.route === this.route);
  }

  /**
   * The bench on screen is now `route`: open its latest conversation. A featured project the user
   * just changed carries on as their copy, and so does the conversation about it.
   */
  follow(route: string) {
    if (route === this.route) return;
    const from = this.route;
    this.route = route;
    if (this.chatId && lab.myProjects.find((p) => p.id === route)?.from === from) {
      this.chats = this.chats.map((c) => (c.id === this.chatId ? { ...c, route } : c));
      this.saveIndex();
      return;
    }
    const latest = this.benchChats[0];
    if (latest) this.open(latest.id);
    else this.reset();
  }

  /** Go on with a saved conversation. */
  open(id: string) {
    const info = this.chats.find((c) => c.id === id);
    let data: ChatData | null = null;
    try {
      data = JSON.parse(localStorage.getItem(chatKey(id)) ?? 'null');
    } catch {}
    if (!info || !data) return this.remove(id);
    this.reset();
    this.chatId = id;
    this.chatSource = info.source;
    this.entries = data.entries;
    this.history = data.history;
    this.session = data.session;
    this.sessionSystem = data.system;
  }

  /** Delete a saved conversation; the one on screen gives way to a new one. */
  remove(id: string) {
    localStorage.removeItem(chatKey(id));
    this.chats = this.chats.filter((c) => c.id !== id);
    this.saveIndex();
    if (this.chatId === id) this.reset();
  }

  private saveIndex() {
    localStorage.setItem(CHATS, JSON.stringify(this.chats));
  }

  /** Keep the conversation on screen, so it can be resumed after the page closes. */
  private save() {
    if (!this.entries.some((e) => e.kind === 'user')) return;
    const id = (this.chatId ??= `c${Date.now().toString(36)}`);
    const first = this.entries.find((e) => e.kind === 'user')!.text.replace(/\s+/g, ' ').trim();
    const info: ChatInfo = { id, route: this.route, title: first.length > 70 ? `${first.slice(0, 69)}…` : first, updated: Date.now(), source: this.chatSource ?? this.source };
    const others = this.chats.filter((c) => c.id !== id);
    // The bench's oldest conversations beyond the limit go
    const old = others.filter((c) => c.route === this.route).slice(PER_BENCH - 1);
    for (const c of old) localStorage.removeItem(chatKey(c.id));
    this.chats = [info, ...others.filter((c) => !old.includes(c))];
    const data = JSON.stringify({ entries: $state.snapshot(this.entries), history: this.history, session: this.session, system: this.sessionSystem } satisfies ChatData);
    // Browser storage is small: make room by dropping the oldest conversations of any bench
    for (;;) {
      try {
        localStorage.setItem(chatKey(id), data);
        break;
      } catch {
        const oldest = this.chats.at(-1);
        if (!oldest || oldest.id === id) {
          this.chats = this.chats.filter((c) => c.id !== id);
          break;
        }
        localStorage.removeItem(chatKey(oldest.id));
        this.chats = this.chats.slice(0, -1);
      }
    }
    this.saveIndex();
  }

  configure(apiKey: string, model: ModelId, source: Source) {
    if (source !== this.source) this.reset();
    this.config = { apiKey: apiKey.trim(), model, source };
    if (this.config.apiKey || this.config.source === 'cli') localStorage.setItem(KEY, JSON.stringify(this.config));
    else localStorage.removeItem(KEY);
  }

  /** A new conversation; the one on screen stays saved. */
  reset() {
    this.stop();
    this.turn++;
    this.busy = false;
    this.waiting = false;
    this.chatId = null;
    this.chatSource = null;
    this.entries = [];
    this.history = [];
    this.session = null;
    this.sessionSystem = undefined;
    lab.emphasis = [];
  }

  stop() {
    this.stream?.abort();
    this.stream = null;
  }

  apply(entry: Extract<Entry, { kind: 'code' }>) {
    lab.setCode(entry.code);
    entry.applied = true;
    this.save();
  }

  /** Put the proposed parts and wires on the bench, planned again if the bench changed since. */
  applyCircuit(entry: Extract<Entry, { kind: 'circuit' }>) {
    let project = $state.snapshot(entry.project) as Project;
    let report = entry.report;
    if (JSON.stringify($state.snapshot(lab.project)) !== entry.base) {
      const r = lab.planChange($state.snapshot(entry.change) as CircuitChange);
      if (!r.ok) {
        lab.notice = `Mạch đã đổi từ lúc trợ lý đề xuất, không áp dụng được nữa: ${r.reason}`;
        return;
      }
      [project, report] = [r.project, r.report];
    }
    if (lab.setCircuit(project, entry.change.parts.map((p) => p.id), `Đã ráp theo đề xuất: ${report.join(' · ')}.`)) {
      entry.applied = true;
      this.save();
    }
  }

  /** Plan a proposal on the bench as it is now and check it: the entry to show it, or why it cannot be built. */
  private plan(summary: string, change: CircuitChange): Extract<Entry, { kind: 'circuit' }> | string {
    const before = $state.snapshot(lab.project) as Project;
    const r = lab.planChange(change);
    if (!r.ok) return r.reason;
    const check = verifyChange(before, r.project);
    return { kind: 'circuit', summary, change, report: r.report, check, base: JSON.stringify(before), project: r.project, applied: false };
  }

  /**
   * A checked proposal with errors, while Claude may still fix it: the errors to send back (the
   * user sees a line saying so). Otherwise null, and the proposal is to be shown.
   */
  private sendBack(entry: Extract<Entry, { kind: 'circuit' }>): string | null {
    const errors = entry.check?.filter((f) => f.level === 'error') ?? [];
    if (!errors.length || this.fixes >= FIXES) return null;
    this.fixes++;
    this.entries.push({ kind: 'tool', text: `Kiểm tra từng linh kiện: ${errors.length} lỗi, nhờ trợ lý sửa lại` });
    return errors.map((f) => `- ${f.text}`).join('\n');
  }

  async ask(question: string) {
    if (this.busy || !question.trim() || !this.ready) return;
    // A conversation resumed from the other way in cannot go on: start a new one
    if (this.chatSource && this.chatSource !== this.source) this.reset();
    this.chatSource = this.source;
    this.fixes = 0;
    if (this.source === 'cli') return this.askCli(question);
    const turn = this.turn;
    this.entries.push({ kind: 'user', text: question });
    this.history.push({ role: 'user', content: `<lab>${situation()}</lab>\n\n${question}` });
    this.busy = true;
    const client = new Anthropic({ apiKey: this.config.apiKey, dangerouslyAllowBrowser: true });
    // Haiku has no server-side fallback for declined requests
    const fallback = this.config.model !== 'claude-haiku-5-5';
    try {
      for (;;) {
        this.waiting = true;
        /** The entry this request's text streams into, once it starts. */
        let text = -1;
        const stream = client.beta.messages.stream({
          model: this.config.model,
          max_tokens: 64000,
          system: SYSTEM,
          tools: TOOLS,
          messages: this.history,
          output_config: { effort: 'medium' },
          cache_control: { type: 'ephemeral' },
          ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        });
        this.stream = stream;
        stream.on('text', (delta) => {
          this.waiting = false;
          if (text < 0) text = this.entries.push({ kind: 'assistant', text: '' }) - 1;
          (this.entries[text] as Extract<Entry, { kind: 'assistant' }>).text += delta;
        });
        const message = await stream.finalMessage();
        this.history.push({ role: 'assistant', content: message.content });

        if (message.stop_reason === 'refusal') {
          this.entries.push({ kind: 'error', text: 'Claude từ chối trả lời câu này.' });
          break;
        }
        const uses = message.content.filter((b): b is Beta.BetaToolUseBlock => b.type === 'tool_use');
        if (!uses.length) break;
        if (message.stop_reason === 'max_tokens') {
          this.entries.push({ kind: 'error', text: 'Câu trả lời quá dài và bị cắt giữa chừng.' });
          break;
        }
        this.history.push({ role: 'user', content: uses.map((u) => this.run(u)) });
      }
    } catch (e) {
      if (turn !== this.turn) return;
      // A turn cut off mid-way is dropped, so the next question starts from a whole conversation
      while (this.history.length && this.history[this.history.length - 1]!.role !== 'user') this.history.pop();
      if (this.history.length && typeof this.history[this.history.length - 1]!.content === 'string') this.history.pop();
      this.entries.push({ kind: 'error', text: describe(e) });
    } finally {
      if (turn === this.turn) {
        this.stream = null;
        this.busy = false;
        this.waiting = false;
        this.save();
      }
    }
  }

  /**
   * Ask through Claude Code on the dev server, with the bench as it is now in the prompt. `check`:
   * the errors found in the circuit it just proposed, sent back for it to fix instead of a question.
   */
  private async askCli(question: string, check?: string) {
    const turn = this.turn;
    // A session started under older instructions would hold on to what they said (that it could
    // only add wires, say): start afresh, with what was said so far in the prompt
    const system = fingerprint(SYSTEM_CLI);
    const earlier = this.session && this.sessionSystem !== system ? recap(this.entries) : '';
    if (earlier) this.session = null;
    if (check) question = `<check>\n${check}\n</check>\nĐề xuất mạch vừa rồi chưa hiện cho người dùng vì kiểm tra từng linh kiện thấy các lỗi trên. Gửi lại khối json circuit đã sửa đúng các lỗi đó (và khối cpp main.cpp nếu code phải đổi theo).`;
    else this.entries.push({ kind: 'user', text: question });
    this.busy = true;
    this.waiting = true;
    const controller = new AbortController();
    this.stream = controller;
    const steps = lessonSteps();
    // The parts catalog once per conversation: --resume keeps it
    const parts = this.session ? '' : `<parts>\n${partCatalog()}\n</parts>\n`;
    const prompt = `${earlier ? `<earlier>\n${earlier}\n</earlier>\n` : ''}<lab>${situation()}</lab>\n<circuit>\n${circuit()}\n</circuit>\n${parts}${steps ? `<lesson>\n${steps}\n</lesson>\n` : ''}<libraries>\n${libraryList()}\n</libraries>\n<code>\n${code()}\n</code>\n<serial>\n${lab.serial.slice(-4000) || '(chưa có dữ liệu Serial)'}\n</serial>\n\n${question}`;
    let text = -1;
    let fix: string | null = null;
    try {
      const r = await fetch('/api/ai/claude', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, system: SYSTEM_CLI, model: this.config.model, session: this.session }),
        signal: controller.signal,
      });
      if (!r.ok || !r.body) throw new Error(r.status === 404 ? 'Bản này không bật Claude Code.' : await r.text());
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop()!;
        for (const line of lines.filter((l) => l.trim())) {
          const m = JSON.parse(line) as { type: 'session'; id: string } | { type: 'text'; text: string } | { type: 'error'; message: string } | { type: 'done' };
          if (m.type === 'session') [this.session, this.sessionSystem] = [m.id, system];
          else if (m.type === 'text') {
            this.waiting = false;
            if (text < 0) text = this.entries.push({ kind: 'assistant', text: '' }) - 1;
            (this.entries[text] as Extract<Entry, { kind: 'assistant' }>).text += m.text;
          } else if (m.type === 'error') this.entries.push({ kind: 'error', text: `Claude Code: ${m.message}` });
        }
      }
    } catch (e) {
      if (turn !== this.turn) return;
      this.entries.push({ kind: 'error', text: controller.signal.aborted ? 'Đã dừng.' : e instanceof Error ? e.message : String(e) });
    } finally {
      if (turn === this.turn) {
        const entry = this.entries[text];
        if (entry?.kind === 'assistant') fix = this.actOn(entry);
        this.stream = null;
        this.busy = false;
        this.waiting = false;
        this.save();
      }
    }
    if (fix && turn === this.turn) await this.askCli('', fix);
  }

  /**
   * Claude Code's tags in a finished answer: highlight on the bench, a circuit and a main.cpp as
   * proposals. The errors to send back if the circuit did not pass its check (nothing shown then).
   */
  private actOn(entry: Extract<Entry, { kind: 'assistant' }>): string | null {
    let t = entry.text;
    const marks = [...t.matchAll(/<highlight>([^<]*)<\/highlight>/g)].flatMap((m) => m[1]!.split(',').map((x) => x.trim()).filter(Boolean));
    t = t.replace(/\n?<highlight>[^<]*<\/highlight>/g, '');
    if (marks.length) lab.emphasis = emphasis(marks);
    const block = /```cpp main\.cpp\n([\s\S]*?)```/.exec(t);
    if (block) t = t.replace(block[0], '');
    const circuit = /```json circuit\n([\s\S]*?)```/.exec(t);
    let fix: string | null = null;
    if (circuit) {
      t = t.replace(circuit[0], '');
      let parsed: ReturnType<typeof parseChange>;
      try {
        parsed = parseChange(JSON.parse(circuit[1]!));
      } catch {
        parsed = 'Khối json circuit không phải JSON hợp lệ.';
      }
      const proposal = typeof parsed === 'string' ? parsed : this.plan(parsed.summary, parsed.change);
      if (typeof proposal === 'string') this.entries.push({ kind: 'error', text: `Đề xuất mạch không ráp được: ${proposal}` });
      else if (!(fix = this.sendBack(proposal))) this.entries.push(proposal);
    }
    entry.text = t.trim();
    // Code written for a circuit sent back comes again with the fixed one
    if (block?.[1]?.trim() && !fix) this.entries.push({ kind: 'code', summary: 'main.cpp mới do trợ lý đề xuất', code: block[1], applied: false });
    return fix;
  }

  /** Run one tool call; what Claude did shows as a quiet line in the chat. */
  private run(use: Beta.BetaToolUseBlock): Beta.BetaToolResultBlockParam {
    const input = use.input as Record<string, unknown>;
    const result = (content: string, is_error = false): Beta.BetaToolResultBlockParam => ({ type: 'tool_result', tool_use_id: use.id, content, is_error });
    const known = lookup(use.name, input, BOARDS[lab.project.board.type]);
    if (known) {
      this.entries.push({ kind: 'tool', text: known.label });
      return result(known.text, known.error);
    }
    switch (use.name) {
      case 'get_circuit':
        this.entries.push({ kind: 'tool', text: 'Xem mạch' });
        return result(circuit());
      case 'get_code':
        this.entries.push({ kind: 'tool', text: 'Đọc code' });
        return result(code());
      case 'get_serial':
        this.entries.push({ kind: 'tool', text: 'Đọc Serial' });
        return result(lab.serial ? lab.serial.slice(-4000) : '(chưa có dữ liệu Serial)');
      case 'get_lesson':
        this.entries.push({ kind: 'tool', text: 'Xem bài học' });
        return result(lessonSteps() ?? 'Người dùng không làm bài học nào lúc này.');
      case 'highlight': {
        if (!Array.isArray(input.items) || !input.items.every((i) => typeof i === 'string')) return result('items phải là danh sách chuỗi', true);
        lab.emphasis = emphasis(input.items as string[]);
        return result('Đã tô sáng.');
      }
      case 'propose_circuit': {
        const parsed = parseChange(input);
        if (typeof parsed === 'string') return result(parsed, true);
        const entry = this.plan(parsed.summary, parsed.change);
        if (typeof entry === 'string') return result(`Không ráp được: ${entry}`, true);
        const errors = this.sendBack(entry);
        if (errors) return result(`Kiểm tra từng linh kiện thấy lỗi, đề xuất chưa hiện cho người dùng:\n${errors}\nSửa đúng các lỗi này rồi gọi lại propose_circuit với cả mạch đã sửa.`, true);
        this.entries.push(entry);
        const check = entry.check?.length ? `\nKiểm tra từng linh kiện còn thấy (người dùng cũng thấy):\n${entry.check.map((f) => `- [${f.level === 'error' ? 'lỗi' : 'lưu ý'}] ${f.text}`).join('\n')}` : '\nKiểm tra từng linh kiện: không thấy lỗi.';
        return result(`Đã hiện đề xuất cho người dùng; họ sẽ tự quyết định có áp dụng không. Nếu áp dụng, lab sẽ:\n${entry.report.map((l) => `- ${l}`).join('\n')}${check}\nCode phải dùng đúng các chân board ở trên.`);
      }
      case 'propose_code': {
        // Streamed tool input is not validated by the API: check it is whole before showing it
        if (typeof input.code !== 'string' || !input.code.trim() || typeof input.summary !== 'string') {
          return result(JSON.stringify({ INVALID_JSON: JSON.stringify(input) }), true);
        }
        this.entries.push({ kind: 'code', summary: input.summary, code: input.code, applied: false });
        return result('Đã hiện đề xuất cho người dùng; họ sẽ tự quyết định có áp dụng không.');
      }
      default:
        return result(`Không có công cụ ${use.name}`, true);
    }
  }
}

/** The lab's own knowledge, the same whatever the bench: parts, board pins, featured projects, libraries. */
export const LOOKUPS = ['list_parts', 'get_part', 'get_pin', 'list_projects', 'get_project', 'list_libraries'];
export const LOOKUP_TOOLS = TOOLS.filter((t) => LOOKUPS.includes(t.name));

/** Answer a lookup tool (see LOOKUPS): the line the chat shows and the result; null for any other tool. */
export function lookup(name: string, input: Record<string, unknown>, board: BoardDef | undefined): { label: string; text: string; error?: boolean } | null {
  switch (name) {
    case 'list_parts':
      return { label: 'Xem danh mục linh kiện', text: partCatalog() };
    case 'get_part': {
      const type = String(input.type ?? '');
      const props = input.props && typeof input.props === 'object' ? (input.props as PartProps) : undefined;
      const text = partInfo(type, props);
      return { label: `Tra linh kiện ${PARTS[type]?.manifest.name ?? type}`, text: text ?? `Không có loại linh kiện "${type}". Các loại có: ${Object.keys(PARTS).join(', ')}`, error: !text };
    }
    case 'get_pin': {
      const pin = typeof input.name === 'string' ? input.name.trim() : '';
      const label = pin ? `Tra chân ${pin}` : 'Xem các chân board';
      if (!board) return { label, text: 'Không biết board trên bàn.', error: true };
      if (!pin) return { label, text: boardPins(board) };
      const text = pinText(board, pin);
      return { label, text: text ?? `${board.name} không có chân "${pin}". Các chân: ${board.pins.map((p) => p.name).join(', ')}`, error: !text };
    }
    case 'list_projects':
      return { label: 'Xem dự án mẫu', text: projectCatalog() };
    case 'get_project': {
      const id = String(input.id ?? '');
      const text = projectInfo(id);
      return { label: `Đọc dự án mẫu ${id}`, text: text ?? `Không có dự án mẫu "${id}", xem list_projects.`, error: !text };
    }
    case 'list_libraries':
      return { label: 'Xem thư viện', text: libraryList() };
    default:
      return null;
  }
}

/** The conversation so far as text, for a new Claude Code session to go on from. */
function recap(entries: Entry[]): string {
  const said = entries.flatMap((e) => (e.kind === 'user' ? [`Người dùng: ${e.text}`] : e.kind === 'assistant' ? [`Trợ lý: ${e.text}`] : []));
  const lines = said.slice(-8).map((t) => (t.length > 800 ? `${t.slice(0, 800)}…` : t));
  return `Cuộc trò chuyện trước đó (trợ lý lúc ấy theo hướng dẫn cũ; theo hướng dẫn hiện tại nếu khác):\n${lines.join('\n\n')}`;
}

export function describe(e: unknown): string {
  if (e instanceof Anthropic.APIUserAbortError) return 'Đã dừng.';
  if (e instanceof Anthropic.AuthenticationError) return 'API key không hợp lệ. Kiểm tra lại key trong phần cài đặt (⚙).';
  if (e instanceof Anthropic.PermissionDeniedError) return 'API key này không được dùng model đã chọn.';
  if (e instanceof Anthropic.RateLimitError) return 'Đang bị giới hạn số yêu cầu, thử lại sau ít phút.';
  if (e instanceof Anthropic.APIConnectionError) return 'Không kết nối được tới Anthropic API. Kiểm tra mạng.';
  if (e instanceof Anthropic.APIError) return `Lỗi từ API (${e.status ?? '?'}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

export const ai = new Assistant();
