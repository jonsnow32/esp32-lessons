<script lang="ts">
  // "Trợ lý AI": ask Claude about the circuit and the code. Without an API key the panel asks
  // for one first; the key stays in this browser. On the dev server, Claude Code on this machine
  // can answer instead.
  import { untrack } from 'svelte';
  import { ai, cli, MODELS, type ModelId, type Source } from '../lib/ai.svelte';
  import { lab } from '../lib/lab.svelte';
  import { layout } from '../lib/layout.svelte';
  import Icon from './Icon.svelte';

  let question = $state('');
  let setup = $state(!ai.ready);
  let key = $state(ai.apiKey);
  let model = $state<ModelId>(ai.model);
  let source = $state<Source>(ai.source);
  // Claude Code chosen before but not on this computer after all: back to asking for a key
  $effect(() => {
    if (!ai.ready) setup = true;
  });
  let list: HTMLDivElement;
  /** Proposals whose code is unfolded. */
  let open = $state<number[]>([]);

  /** The list of earlier conversations about this bench is showing. */
  let showChats = $state(false);

  // Another bench, its own conversations: the latest one opens
  $effect(() => {
    const route = lab.route;
    untrack(() => ai.follow(route));
  });

  const when = (t: number) => new Date(t).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
  const SOURCE: Record<Source, string> = { api: 'API key', cli: 'Claude Code' };
  $effect(() => {
    // Follow the newest message as it streams in
    void ai.entries.length;
    void (ai.entries.at(-1) as { text?: string } | undefined)?.text;
    void ai.waiting;
    if (list) list.scrollTop = list.scrollHeight;
  });

  let suggestions = $derived([
    ...(lab.build.status === 'failed' ? ['Vì sao code build lỗi, sửa thế nào?'] : []),
    'Mạch của mình đang làm gì?',
    'Mạch có chỗ nào sai hay nguy hiểm không?',
    'Giải thích code từng phần',
  ]);

  function send(text = question) {
    if (!text.trim() || ai.busy) return;
    void ai.ask(text.trim());
    question = '';
  }

  function save() {
    ai.configure(key, model, source);
    setup = !ai.ready;
  }

  /** Light markdown: ``` fences, `code` and **bold**; everything else as typed. */
  function blocks(text: string) {
    return text.split(/```[^\n]*\n?/).map((part, i) => ({ code: i % 2 === 1, text: i % 2 === 1 ? part.replace(/\n$/, '') : part }));
  }
  function spans(text: string) {
    return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/).map((s) =>
      s.startsWith('`') && s.endsWith('`') && s.length > 1 ? { kind: 'code', text: s.slice(1, -1) }
      : s.startsWith('**') && s.endsWith('**') && s.length > 3 ? { kind: 'bold', text: s.slice(2, -2) }
      : { kind: 'text', text: s });
  }
</script>

<section>
  <h2>
    Trợ lý AI
    <span class="actions">
      {#if ai.benchChats.length}<button class="icon" title="Các cuộc trò chuyện trước" aria-label="Các cuộc trò chuyện trước" aria-pressed={showChats} onclick={() => { showChats = !showChats; setup = false; }}><Icon name="history" size={14} /></button>{/if}
      {#if ai.entries.length}<button class="icon" title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới" onclick={() => { ai.reset(); showChats = false; }}><Icon name="plus" size={14} /></button>{/if}
      <button class="icon" title="Cài đặt API key và model" aria-label="Cài đặt" aria-pressed={setup} onclick={() => { setup = !setup; showChats = false; }}><Icon name="more" size={14} /></button>
    </span>
  </h2>

  {#if setup}
    <form class="setup" onsubmit={(e) => { e.preventDefault(); save(); }}>
      {#if cli.available}
        <fieldset>
          <legend>Nguồn</legend>
          <label class="radio"><input type="radio" bind:group={source} value="cli" />Claude Code trên máy này (gói Pro/Max)</label>
          <label class="radio"><input type="radio" bind:group={source} value="api" />Anthropic API key</label>
        </fieldset>
      {/if}
      {#if source === 'api'}
        <p>Trợ lý dùng Claude của Anthropic với API key của bạn. Tạo key tại <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>; phí tính vào tài khoản của bạn.</p>
        <label>API key
          <input type="password" bind:value={key} placeholder="sk-ant-…" autocomplete="off" spellcheck="false" />
        </label>
      {:else}
        <p class="note">Câu hỏi chạy qua <code>claude -p</code> với tài khoản Claude Code đang đăng nhập, tính vào hạn mức gói của bạn.</p>
      {/if}
      <label>Model
        <select bind:value={model}>
          {#each MODELS as m}<option value={m.id}>{m.label}</option>{/each}
        </select>
      </label>
      {#if source === 'api'}<p class="note">Key chỉ lưu trong trình duyệt trên máy này và gửi thẳng tới Anthropic. Để trống rồi lưu để xoá key.</p>{/if}
      <div class="row">
        <button type="submit" class="primary">Lưu</button>
        {#if ai.ready}<button type="button" onclick={() => { key = ai.apiKey; model = ai.model; source = ai.source; setup = false; }}>Huỷ</button>{/if}
      </div>
    </form>
  {:else if showChats}
    <ul class="chats">
      {#each ai.benchChats as c (c.id)}
        <li class:current={c.id === ai.chatId}>
          <button class="open" onclick={() => { ai.open(c.id); showChats = false; }}>
            <span class="title">{c.title}</span>
            <span class="meta">{when(c.updated)}{c.source !== ai.source ? ` · ${SOURCE[c.source]}` : ''}</span>
          </button>
          <button class="icon" title="Xoá cuộc trò chuyện này" aria-label="Xoá cuộc trò chuyện này" onclick={() => ai.remove(c.id)}><Icon name="trash" size={14} /></button>
        </li>
      {/each}
    </ul>
    <p class="note">Lưu trong trình duyệt trên máy này, tối đa 10 cuộc trò chuyện cho mỗi bài học hay dự án. Cuộc trò chuyện ghi nguồn khác (API key hay Claude Code) chỉ xem lại được; hỏi tiếp sẽ mở cuộc trò chuyện mới.</p>
  {:else}
    <div class="chat" bind:this={list}>
      {#if !ai.entries.length}
        <p class="empty">Hỏi về mạch hay code trên bàn: trợ lý xem được sơ đồ nối dây, điện áp đang đo, code, lỗi build và Serial. Code và linh kiện nó đề xuất chỉ vào editor, vào mạch khi bạn bấm áp dụng.</p>
        <div class="chips">
          {#each suggestions as s}<button onclick={() => send(s)}>{s}</button>{/each}
        </div>
      {/if}
      {#each ai.entries as e, i}
        {#if e.kind === 'user'}
          <div class="msg user">{e.text}</div>
        {:else if e.kind === 'assistant'}
          <div class="msg assistant">
            {#each blocks(e.text) as b}
              {#if b.code}<pre>{b.text}</pre>{:else}<p>{#each spans(b.text) as s}{#if s.kind === 'code'}<code>{s.text}</code>{:else if s.kind === 'bold'}<strong>{s.text}</strong>{:else}{s.text}{/if}{/each}</p>{/if}
            {/each}
          </div>
        {:else if e.kind === 'tool'}
          <div class="tool"><Icon name="probe" size={12} />{e.text}</div>
        {:else if e.kind === 'code'}
          <div class="proposal">
            <div class="head"><Icon name="edit" size={14} /><span>{e.summary}</span></div>
            {#if open.includes(i)}<pre>{e.code}</pre>{/if}
            <div class="row">
              <button onclick={() => (open = open.includes(i) ? open.filter((x) => x !== i) : [...open, i])}>{open.includes(i) ? 'Ẩn code' : 'Xem code'}</button>
              {#if e.applied}
                <span class="done"><Icon name="check" size={14} />Đã đưa vào editor</span>
              {:else}
                <button class="primary" onclick={() => { ai.apply(e); layout.reveal('code'); }}>Áp dụng vào editor</button>
              {/if}
            </div>
          </div>
        {:else if e.kind === 'circuit'}
          <div class="proposal">
            <div class="head"><Icon name="plus" size={14} /><span>{e.summary}</span></div>
            {#if open.includes(i)}<ul>{#each e.report as line}<li>{line}</li>{/each}</ul>{/if}
            {#if e.check}
              {#if e.check.length}
                <ul class="check">{#each e.check as f}<li class={f.level}>{f.level === 'error' ? 'Lỗi' : 'Lưu ý'}: {f.text}</li>{/each}</ul>
              {:else}
                <span class="done"><Icon name="check" size={14} />Đã kiểm tra từng linh kiện: không thấy lỗi</span>
              {/if}
            {/if}
            <div class="row">
              <button onclick={() => (open = open.includes(i) ? open.filter((x) => x !== i) : [...open, i])}>{open.includes(i) ? 'Ẩn chi tiết' : 'Xem chi tiết'}</button>
              {#if e.applied}
                <span class="done"><Icon name="check" size={14} />Đã ráp vào mạch</span>
              {:else}
                <button class="primary" onclick={() => ai.applyCircuit(e)}>Áp dụng vào mạch</button>
              {/if}
            </div>
          </div>
        {:else}
          <div class="msg error" role="alert">{e.text}</div>
        {/if}
      {/each}
      {#if ai.waiting}<div class="tool thinking">Đang suy nghĩ…</div>{/if}
    </div>

    <form class="ask" onsubmit={(e) => { e.preventDefault(); send(); }}>
      <textarea bind:value={question} rows="2" placeholder="Hỏi về mạch hoặc code… (Enter để gửi, Shift+Enter xuống dòng)"
        onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } }}></textarea>
      {#if ai.busy}
        <button type="button" onclick={() => ai.stop()}>Dừng</button>
      {:else}
        <button type="submit" class="primary" disabled={!question.trim()}>Gửi</button>
      {/if}
    </form>
  {/if}
</section>

<style>
  section { display: flex; flex-direction: column; min-height: 0; flex: 1; padding: 10px 12px; gap: 8px; }
  h2 { display: flex; align-items: center; font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .09em; color: var(--ink-3); margin: 0; }
  .actions { margin-left: auto; display: flex; gap: 2px; }
  .icon { display: flex; padding: 3px 5px; background: transparent; border-color: transparent; color: var(--ink-3); }
  .icon:hover, .icon[aria-pressed='true'] { background: var(--surface-3); }
  .setup { display: flex; flex-direction: column; gap: 10px; font-size: var(--fs-sm); line-height: 1.5; }
  .setup p { margin: 0; color: var(--ink-2); }
  .setup .note { color: var(--ink-3); font-size: var(--fs-xs); }
  .setup label { display: flex; flex-direction: column; gap: 4px; font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); }
  fieldset { border: 1px solid var(--line); margin: 0; padding: 6px 10px 8px; display: flex; flex-direction: column; gap: 4px; }
  legend { font: 600 var(--fs-label) var(--font-mono); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); padding: 0 4px; }
  .setup label.radio { flex-direction: row; align-items: center; gap: 6px; font: var(--fs-sm) var(--font-ui); text-transform: none; letter-spacing: 0; color: var(--ink); }
  .setup input, .setup select { font: var(--fs-sm) var(--font-ui); text-transform: none; letter-spacing: 0; }
  .setup input { font-family: var(--font-mono); }
  .row { display: flex; gap: 6px; align-items: center; }
  .chats { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; overflow: auto; flex: 1; min-height: 0; }
  .chats li { display: flex; align-items: center; gap: 2px; border: 1px solid var(--line); background: var(--surface); }
  .chats li.current { box-shadow: inset 3px 0 0 var(--accent); }
  .chats .open { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 6px 10px; background: transparent; border: 0; text-align: left; }
  .chats .open:hover { background: var(--surface-3); }
  .chats .title { font-size: var(--fs-sm); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .chats .meta { font: var(--fs-xs) var(--font-mono); color: var(--ink-4); }
  section > .note { margin: 0; font-size: var(--fs-xs); color: var(--ink-3); line-height: 1.5; }
  .chat { flex: 1; min-height: 120px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
  .empty { font-size: 12px; color: var(--ink-3); margin: 0; line-height: 1.5; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips button { font-size: var(--fs-xs); padding: 4px 8px; text-align: left; }
  .msg { font-size: var(--fs-md); line-height: 1.5; }
  .msg.user { align-self: flex-end; max-width: 88%; padding: 6px 10px; background: var(--accent-soft); border: 1px solid #f2cfb4; white-space: pre-wrap; }
  .msg.assistant p { margin: 0; white-space: pre-wrap; }
  .msg.error { padding: 6px 10px; background: var(--error-soft); color: var(--error); border: 1px solid var(--error-line); }
  code { font: 12px var(--font-mono); background: var(--surface-3); padding: 0 3px; }
  pre { margin: 4px 0; padding: 8px 10px; background: var(--term); color: #d7dde2; font: 12px/1.45 var(--font-mono); overflow: auto; white-space: pre; border: 1px solid #000; }
  .tool { display: flex; align-items: center; gap: 6px; font: var(--fs-xs) var(--font-mono); color: var(--ink-4); }
  .thinking { animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .4; } }
  .proposal { border: 1px solid var(--line); background: var(--surface); box-shadow: inset 3px 0 0 var(--signal); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; font-size: var(--fs-md); }
  .proposal .head { display: flex; gap: 6px; align-items: flex-start; }
  .proposal .head :global(.ico) { margin-top: 2px; color: var(--signal); flex: 0 0 auto; }
  .proposal pre { max-height: 260px; }
  .proposal ul { margin: 0; padding-left: 18px; font-size: var(--fs-sm); color: var(--ink-2); line-height: 1.45; }
  .proposal .check { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 3px; }
  .proposal .check li { padding: 3px 8px; border-left: 3px solid; }
  .proposal .check .error { background: var(--error-soft); color: var(--error); border-color: var(--error); }
  .proposal .check .warn { background: var(--warn-soft); color: var(--warn); border-color: var(--warn-dot); }
  .done { display: flex; align-items: center; gap: 4px; color: var(--ok); font-size: var(--fs-sm); }
  .primary { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 600; }
  .primary:hover:not(:disabled) { background: #a94507; }
  .ask { display: flex; gap: 6px; align-items: flex-end; }
  .ask textarea { flex: 1; resize: vertical; min-height: 38px; font: var(--fs-md)/1.4 var(--font-ui); box-sizing: border-box; }
</style>
