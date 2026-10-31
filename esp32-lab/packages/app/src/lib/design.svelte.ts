// A new bench from a description: the user says what they want to build, Claude picks the board,
// the breadboard (or none), the parts and the wires, and writes main.cpp. Like the assistant's
// circuit proposals (ai.svelte.ts), the design is laid out on an empty bench by the lab
// (applyChange) and checked part by part (verify.ts) before the user sees it; then it is held
// against the user's box of parts (inventory.svelte.ts):
//
//   describe → Claude proposes a bench → plan on an empty bench → check the circuit → check the stock
//            ↑__________ errors (and, with "only what I have", missing items) go back __________|
//
// What is still missing when the design is shown, the user can mark as stocked after all, ask
// Claude to swap for what is in the box, or leave to buy. Nothing is saved until they create it.
//
// It goes through the same way in as the assistant, with its key and model: the API with tools,
// or Claude Code on this computer with the catalog in the prompt and the design back as a tagged
// block.

import Anthropic from '@anthropic-ai/sdk';
import type * as Beta from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ProjectCheck } from '@esp32lab/inventory';
import type { Project } from '@esp32lab/project-model';
import { ai, describe, LOOKUP_TOOLS, lookup, parseChange } from './ai.svelte';
import type { CircuitChange } from './autoplug';
import { BOARDS, BREADBOARDS, PARTS } from './catalog';
import { inventory, itemName } from './inventory.svelte';
import { libraryList, partCatalog } from './knowledge';
import { lab } from './lab.svelte';
import { verifyCircuit, type Finding } from './verify';

/** What Claude proposed: the bench to set up and the circuit to build on it. */
export interface BenchDesign {
  title: string;
  summary: string;
  board: string;
  breadboard: string | null;
  change: CircuitChange;
  code: string | null;
}

/** A design laid out on an empty bench and checked: the circuit, then the stock. */
export interface DesignPlan {
  design: BenchDesign;
  project: Project;
  report: string[];
  check: Finding[];
  stock: ProjectCheck;
}

/** Designs with errors sent back to Claude in one go before the next is shown as it is. */
const FIXES = 3;

const RULES = `- Trả lời bằng tiếng Việt, ngắn gọn. Dùng dấu phẩy thập phân (3,3 V).
- Chỉ dùng loại linh kiện, board và breadboard có trong lab. Thiết kế đơn giản nhất làm được việc người dùng tả, hợp cho người mới.
- Tự rà từng linh kiện trước khi đề xuất: mỗi chân nối đi đâu, nguồn và GND của module, LED có điện trở hạn dòng, đúng chiều cực, chân GPIO làm được việc đó (không phải chân chỉ vào, chân flash hay strapping), tải lớn như bơm, động cơ đi qua relay hoặc MOSFET.
- Mỗi chân tín hiệu mà code dùng phải có dây ghi rõ tới chân board ("board:D4"); chân nguồn, GND và điện trở kéo, hạn dòng để trống thì lab tự cắm theo cách nối mẫu. Điện trở lab tự thêm có giá trị theo cách nối mẫu; muốn dùng giá trị khác (ví dụ cho khớp kho) thì tự thêm điện trở đó vào parts và nối dây cho nó.
- Code là toàn bộ main.cpp (Arduino framework), chỉ dùng thư viện build được, dùng đúng các chân board đã nối.
- Kho linh kiện của người dùng: ưu tiên món có trong kho (đúng loại và thông số, ví dụ điện trở 220 Ω khác 330 Ω, LED đỏ khác LED xanh), kể cả board và breadboard. Nếu được yêu cầu chỉ dùng đồ trong kho thì món thiếu là lỗi: thay bằng món có sẵn làm được việc đó, hoặc bỏ nếu không cần; nếu không thể làm được nếu thiếu nó thì giữ lại và nói rõ vì sao.
- Lab ráp thử và kiểm tra lại từng linh kiện bằng mô phỏng, rồi đối chiếu với kho; nếu có lỗi, bạn sẽ nhận danh sách lỗi: sửa đúng các lỗi đó rồi gửi lại cả bàn.`;

const SYSTEM = `Bạn thiết kế bàn làm việc mới trong ESP32 Lab, phòng thí nghiệm mô phỏng cho người mới học điện tử và lập trình ESP32. Người dùng tả điều họ muốn làm; bạn chọn board, breadboard (hoặc không dùng), linh kiện, dây nối và viết main.cpp, rồi gọi propose_bench. Người dùng xem bàn và tự bấm tạo.

${RULES}
- Tra get_part trước khi dùng một loại linh kiện để biết tên chân và cách nối; xem dự án mẫu gần nhất (list_projects, get_project) vì code đó đã chạy được trong lab; tra get_pin khi chọn chân.
- Sau khi propose_bench được nhận, trả lời người dùng một hai câu: bàn làm gì, cần lưu ý gì.`;

const SYSTEM_CLI = `Bạn thiết kế bàn làm việc mới trong ESP32 Lab, phòng thí nghiệm mô phỏng cho người mới học điện tử và lập trình ESP32. Người dùng tả điều họ muốn làm; bạn chọn board, breadboard (hoặc không dùng), linh kiện, dây nối và viết main.cpp.

${RULES}
- Câu hỏi kèm <boards>, <parts> (mã loại và tên chân), <libraries> và <stock> (kho của người dùng).
- Đặt bàn trong đúng một khối \`\`\`json bench … \`\`\` chứa {"title": "…", "summary": "…", "board": "<mã board>", "breadboard": "<mã breadboard>" hoặc null, "parts": [{"id": "pump1", "type": "water-pump", "props": {}}], "wires": [{"from": "relay1.no", "to": "pump1.pos"}], "code": "<toàn bộ main.cpp>"}. Đầu dây là chân linh kiện ("relay1.com") hoặc chân board ("board:VIN"). Ngoài khối đó trả lời một hai câu: bàn làm gì, cần lưu ý gì. Nếu nhận <check> thì gửi lại khối json bench đã sửa.`;

const PROPOSE: Beta.BetaTool = {
  name: 'propose_bench',
  description:
    'Đề xuất bàn mới: board, breadboard, linh kiện, dây và main.cpp. Lab ráp thử trên bàn trống, kiểm tra từng linh kiện và đối chiếu với kho của người dùng; có lỗi thì trả về để bạn sửa, không thì hiện cho người dùng kèm từng việc lab đã làm (linh kiện cắm ở đâu, chân nào nối chân board nào).',
  eager_input_streaming: true,
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Tên dự án, ngắn, ví dụ "Tưới cây tự động".' },
      summary: { type: 'string', description: 'Một hai câu: bàn làm gì.' },
      board: { type: 'string', description: 'Mã board (xem trong câu hỏi).' },
      breadboard: { type: ['string', 'null'], description: 'Mã breadboard, hoặc null để nối dây thẳng tới board.' },
      parts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'id, ví dụ "led1".' },
            type: { type: 'string', description: 'Mã loại linh kiện (xem list_parts).' },
            props: { type: 'object', description: 'Thông số, ví dụ {"color":"green"}. Bỏ trống thì dùng mặc định.' },
          },
          required: ['id', 'type'],
        },
      },
      wires: {
        type: 'array',
        description: 'Dây cần đi đúng chỗ. Mỗi đầu là chân linh kiện ("relay1.com") hoặc chân board ("board:D23").',
        items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
      },
      code: { type: 'string', description: 'Toàn bộ main.cpp.' },
    },
    required: ['title', 'summary', 'board', 'breadboard', 'parts', 'wires', 'code'],
  },
};

/** The boards and breadboards to choose from, a line each. */
function benches(): string {
  return [
    'Board (mã: tên):',
    ...Object.entries(BOARDS).map(([type, b]) => `- ${type}: ${b.name}, ${b.pins.length} chân`),
    'Breadboard (mã: tên):',
    ...Object.entries(BREADBOARDS).map(([type, d]) => `- ${type}: ${d.name}, ${d.columns} cột${d.rails.length ? ', có ray nguồn' : ''}`),
  ].join('\n');
}

/** The user's box of parts as Claude reads it: catalog id and props, so it can ask for that very item. */
function stockText(): string {
  const items = inventory.items.filter((i) => i.qty > 0 && i.kind !== 'custom');
  if (!items.length) return 'Kho trống: người dùng chưa ghi lại linh kiện nào.';
  return [
    'Kho của người dùng (loại, mã, thông số: số lượng):',
    ...items.map((i) => `- ${i.kind === 'part' ? 'linh kiện' : i.kind} ${i.type}${i.props && Object.keys(i.props).length ? ` ${JSON.stringify(i.props)}` : ''} (${itemName(i)}): ${i.qty}`),
  ].join('\n');
}

/** A design as Claude sent it, checked for shape; a string says what is wrong. */
function parseDesign(input: Record<string, unknown>): BenchDesign | string {
  const { title, board, breadboard = null, code } = input;
  const change = parseChange({ ...input, remove: [], disconnect: [] });
  if (typeof change === 'string') return change;
  if (typeof title !== 'string' || !title.trim()) return 'Cần title (chuỗi).';
  if (typeof board !== 'string' || !BOARDS[board]) return `Không có board "${String(board)}". Có: ${Object.keys(BOARDS).join(', ')}.`;
  if (breadboard !== null && (typeof breadboard !== 'string' || !BREADBOARDS[breadboard])) return `Không có breadboard "${String(breadboard)}". Có: ${Object.keys(BREADBOARDS).join(', ')}, hoặc null.`;
  return { title: title.trim(), summary: change.summary, board, breadboard, change: change.change, code: typeof code === 'string' && code.trim() ? code : null };
}

const missingText = (stock: ProjectCheck) =>
  stock.lines.filter((l) => l.missing).map((l) => `- Kho thiếu ${l.missing} ${itemName(l)} (${l.kind === 'part' ? `${l.type}${Object.keys(l.props).length ? ` ${JSON.stringify(l.props)}` : ''}` : `${l.kind} ${l.type}`}): cần ${l.qty}, có ${l.have}.`);

class Designer {
  /** What the user asked for, then what they asked to change. */
  asked = $state<string[]>([]);
  /** Only parts from the box: what is missing goes back to Claude like an error. */
  stockOnly = $state(false);
  busy = $state(false);
  /** What is being done, a line per step, for the user to follow. */
  log = $state<string[]>([]);
  /** Claude's words with the latest design. */
  note = $state('');
  error = $state<string | null>(null);
  plan = $state<DesignPlan | null>(null);
  private history: Beta.BetaMessageParam[] = [];
  private session: string | null = null;
  private stream: { abort(): void } | null = null;
  private fixes = 0;
  private turn = 0;

  /** The stock the latest design is held against, again: it changes as the user marks items stocked. */
  get stock(): ProjectCheck | null {
    return this.plan ? inventory.check(this.plan.project) : null;
  }

  reset() {
    this.stop();
    this.turn++;
    this.asked = [];
    this.busy = false;
    this.log = [];
    this.note = '';
    this.error = null;
    this.plan = null;
    this.history = [];
    this.session = null;
  }

  stop() {
    this.stream?.abort();
    this.stream = null;
  }

  /** Design a bench for `text`, or change the one shown the way `text` says. */
  async ask(text: string) {
    if (this.busy || !text.trim() || !ai.ready) return;
    this.asked.push(text.trim());
    this.fixes = 0;
    this.error = null;
    this.log = [];
    const only = this.stockOnly ? '\nChỉ dùng đồ có trong kho.' : '';
    const first = !this.history.length && !this.session;
    const question = first ? `${text.trim()}${only}` : `Sửa bàn vừa đề xuất: ${text.trim()}${only}`;
    if (ai.source === 'cli') return this.askCli(question);
    return this.askApi(`<stock>\n${stockText()}\n</stock>\n${first ? `<benches>\n${benches()}\n</benches>\n` : ''}\n${question}`);
  }

  /** Ask Claude to swap what the box does not have for what it does. */
  useStock() {
    const stock = this.stock;
    if (!stock || stock.complete) return;
    void this.ask(`Kho đang thiếu:\n${missingText(stock).join('\n')}\nThay các món này bằng đồ có sẵn trong kho nếu được.`);
  }

  /** Mark everything still missing as stocked: the user has it, the box just did not say so. */
  stockMissing() {
    for (const l of this.stock?.lines ?? []) if (l.missing) inventory.add(l.kind, l.type, l.props, l.missing);
  }

  /** Create the project from the design shown and open it. */
  async create(title: string) {
    const plan = this.plan;
    if (!plan || this.busy) return;
    await lab.createMyProject(title || plan.design.title, $state.snapshot(plan.project) as Project, plan.design.code ?? undefined);
    lab.notice = `Đã tạo bàn theo mô tả: ${plan.design.summary}`;
    this.reset();
  }

  /**
   * Lay a design out on an empty bench and check it: the errors to send back while Claude may still
   * fix them (nothing is shown then), the plan now shown, or why it cannot be built.
   */
  private propose(input: Record<string, unknown>): { send: string } | { shown: DesignPlan } | { failed: string } {
    const design = parseDesign(input);
    if (typeof design === 'string') return { failed: design };
    this.log.push(`Ráp thử ${design.change.parts.length} linh kiện trên ${BOARDS[design.board]!.name.replace(/ \(.*/, '')}`);
    const r = lab.planBench(design.board, design.breadboard, design.change);
    if (!r.ok) return { failed: r.reason };
    const check = verifyCircuit(r.project);
    const stock = inventory.check(r.project);
    const errors = check.filter((f) => f.level === 'error').map((f) => `- ${f.text}`);
    const missing = missingText(stock);
    this.log.push(`Kiểm tra từng linh kiện: ${errors.length ? `${errors.length} lỗi` : 'ổn'} · kho: ${stock.complete ? 'đủ' : `thiếu ${stock.needCount - stock.haveCount}/${stock.needCount} món`}`);
    const back = [...errors, ...(this.stockOnly ? missing : [])];
    if (back.length && this.fixes < FIXES) {
      this.fixes++;
      this.log.push('Nhờ Claude sửa lại');
      return { send: back.join('\n') };
    }
    const plan = { design, project: r.project, report: r.report, check, stock };
    this.plan = plan;
    return { shown: plan };
  }

  /** What Claude reads once a design is shown. */
  private shownText(plan: DesignPlan): string {
    const check = plan.check.length ? `Kiểm tra còn thấy (người dùng cũng thấy):\n${plan.check.map((f) => `- [${f.level === 'error' ? 'lỗi' : 'lưu ý'}] ${f.text}`).join('\n')}` : 'Kiểm tra từng linh kiện: không thấy lỗi.';
    const missing = missingText(plan.stock);
    return `Đã hiện bàn cho người dùng. Lab đã:\n${plan.report.map((l) => `- ${l}`).join('\n')}\n${check}\n${missing.length ? `Đối chiếu kho:\n${missing.join('\n')}` : 'Kho có đủ mọi món.'}\nNếu code dùng chân board khác các chân ở trên thì gửi lại cả bàn với code đã sửa.`;
  }

  private async askApi(content: string) {
    const turn = this.turn;
    this.history.push({ role: 'user', content });
    this.busy = true;
    this.note = '';
    const client = new Anthropic({ apiKey: ai.apiKey, dangerouslyAllowBrowser: true });
    const fallback = ai.model !== 'claude-haiku-5-5';
    try {
      // Lookups and fixes, but not for ever
      for (let round = 0; round < 24; round++) {
        this.log.push('Claude đang nghĩ');
        const stream = client.beta.messages.stream({
          model: ai.model,
          max_tokens: 64000,
          system: `${SYSTEM}\n\n${partCatalog()}`,
          tools: [...LOOKUP_TOOLS, PROPOSE],
          messages: this.history,
          output_config: { effort: 'medium' },
          cache_control: { type: 'ephemeral' },
          ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        });
        this.stream = stream;
        const message = await stream.finalMessage();
        if (turn !== this.turn) return;
        this.history.push({ role: 'assistant', content: message.content });
        const said = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
        if (said) this.note = said;
        if (message.stop_reason === 'refusal') throw new Error('Claude từ chối thiết kế bàn này.');
        const uses = message.content.filter((b): b is Beta.BetaToolUseBlock => b.type === 'tool_use');
        if (!uses.length) break;
        if (message.stop_reason === 'max_tokens') throw new Error('Câu trả lời quá dài và bị cắt giữa chừng.');
        this.history.push({ role: 'user', content: uses.map((u) => this.run(u)) });
      }
      if (!this.plan) this.error = this.note ? 'Claude chưa đưa ra bàn nào (xem lời nhắn bên dưới).' : 'Claude chưa đưa ra bàn nào, thử tả rõ hơn.';
    } catch (e) {
      if (turn !== this.turn) return;
      // A turn cut off mid-way is dropped, so the next request starts from a whole conversation
      while (this.history.length && this.history[this.history.length - 1]!.role !== 'user') this.history.pop();
      if (this.history.length && typeof this.history[this.history.length - 1]!.content === 'string') this.history.pop();
      this.error = describe(e);
    } finally {
      if (turn === this.turn) {
        this.stream = null;
        this.busy = false;
      }
    }
  }

  private run(use: Beta.BetaToolUseBlock): Beta.BetaToolResultBlockParam {
    const input = use.input as Record<string, unknown>;
    const result = (content: string, is_error = false): Beta.BetaToolResultBlockParam => ({ type: 'tool_result', tool_use_id: use.id, content, is_error });
    if (use.name === 'propose_bench') {
      const r = this.propose(input);
      if ('failed' in r) {
        this.fixes++;
        this.log.push(`Không ráp được: ${r.failed}`);
        return result(`Không ráp được: ${r.failed}${this.fixes > FIXES ? '\nĐừng thử nữa: nói cho người dùng vì sao chưa thiết kế được.' : ''}`, true);
      }
      if ('send' in r) return result(`Bàn chưa hiện cho người dùng vì thấy các lỗi sau:\n${r.send}\nSửa đúng các lỗi này rồi gọi lại propose_bench với cả bàn đã sửa.`, true);
      return result(this.shownText(r.shown));
    }
    // Pins of the board of the design shown, before the first one of the board most benches use
    const known = lookup(use.name, input, BOARDS[this.plan?.design.board ?? ''] ?? Object.values(BOARDS)[0]);
    if (!known) return result(`Không có công cụ ${use.name}`, true);
    this.log.push(known.label);
    return result(known.text, known.error);
  }

  /** Through Claude Code on this computer; `check`: the errors found in its last design, to fix. */
  private async askCli(question: string, check?: string) {
    const turn = this.turn;
    this.busy = true;
    this.note = '';
    const controller = new AbortController();
    this.stream = controller;
    const intro = this.session ? '' : `<boards>\n${benches()}\n</boards>\n<parts>\n${partCatalog()}\n</parts>\n<libraries>\n${libraryList()}\n</libraries>\n`;
    const ask = check ? `<check>\n${check}\n</check>\nBàn vừa rồi chưa hiện cho người dùng vì thấy các lỗi trên. Gửi lại khối json bench đã sửa đúng các lỗi đó.` : question;
    const prompt = `${intro}<stock>\n${stockText()}\n</stock>\n\n${ask}`;
    let text = '';
    let fix: string | null = null;
    this.log.push('Claude đang nghĩ');
    try {
      const r = await fetch('/api/ai/claude', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, system: SYSTEM_CLI, model: ai.model, session: this.session }),
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
          if (m.type === 'session') this.session = m.id;
          else if (m.type === 'text') text += m.text;
          else if (m.type === 'error') throw new Error(`Claude Code: ${m.message}`);
        }
      }
      if (turn !== this.turn) return;
      const block = /```json bench\n([\s\S]*?)```/.exec(text);
      this.note = text.replace(block?.[0] ?? '', '').trim();
      if (!block) throw new Error(this.note ? 'Claude chưa đưa ra bàn nào (xem lời nhắn bên dưới).' : 'Claude chưa đưa ra bàn nào, thử tả rõ hơn.');
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(block[1]!);
      } catch {
        throw new Error('Khối json bench không phải JSON hợp lệ.');
      }
      const r2 = this.propose(input);
      if ('failed' in r2) {
        if (this.fixes >= FIXES) throw new Error(`Không ráp được bàn Claude đề xuất: ${r2.failed}`);
        this.fixes++;
        fix = `- Không ráp được: ${r2.failed}`;
      } else if ('send' in r2) fix = r2.send;
    } catch (e) {
      if (turn !== this.turn) return;
      this.error = controller.signal.aborted ? 'Đã dừng.' : e instanceof Error ? e.message : String(e);
    } finally {
      if (turn === this.turn) {
        this.stream = null;
        this.busy = false;
      }
    }
    if (fix && turn === this.turn) await this.askCli('', fix);
  }
}

export const designer = new Designer();
