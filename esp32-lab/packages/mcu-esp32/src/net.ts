// The emulator's virtual network on the host side (see crates/esp32-soc/src/net.rs): the
// firmware's TCP sockets and DNS lookups become requests (NetOp) the page hands to a link,
// whose answers (NetEvent) go back into the emulator before it runs on.
//
// LabNetwork carries them to the lab server (/api/net, packages/lab-server/src/net.ts), which
// opens the real connections: one stream of events per emulated chip, one POST per batch.

/** What the firmware asks for. `conn` numbers a connection for its whole life. */
export type NetOp =
  | { t: 'connect'; conn: number; ip: string; port: number }
  | { t: 'send'; conn: number; data: Uint8Array }
  | { t: 'close'; conn: number }
  | { t: 'resolve'; name: string };

/** What the host answers. `errno` as newlib numbers it: 111 refused, 116 timed out, 118 unreachable. */
export type NetEvent =
  | { t: 'connected'; conn: number }
  | { t: 'data'; conn: number; data: Uint8Array }
  | { t: 'closed'; conn: number }
  | { t: 'failed'; conn: number; errno: number }
  | { t: 'resolved'; name: string; ip: string | null };

export interface NetLink {
  send(ops: NetOp[]): void;
  /** Events that arrived since the last call. */
  take(): NetEvent[];
  close(): void;
}

const toBase64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Requests and answers through the lab server's /api/net. */
export class LabNetwork implements NetLink {
  private readonly session = Math.random().toString(36).slice(2) + Date.now().toString(36);
  private events: NetEvent[] = [];
  private readonly abort = new AbortController();
  private opened = false;
  /** Batches in order: a send must not overtake the connect before it. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Why the lab server cannot be reached, if it cannot (shown once in the console). */
  error: string | null = null;

  constructor(private readonly base = '/api/net') {}

  private url(path: string) {
    return `${this.base}/${path}?s=${encodeURIComponent(this.session)}`;
  }

  /** The event stream opens with the first request: a sketch without Wi-Fi costs nothing. */
  private open(): void {
    this.opened = true;
    void (async () => {
      try {
        const res = await fetch(this.url('events'), { headers: { 'x-esp32lab': '1' }, signal: this.abort.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (line) this.events.push(this.decode(JSON.parse(line)));
          }
        }
      } catch (e) {
        if (!this.abort.signal.aborted) this.fail(e);
      }
    })();
  }

  private decode(m: { t: string; conn?: number; d?: string; errno?: number; name?: string; ip?: string | null }): NetEvent {
    switch (m.t) {
      case 'data':
        return { t: 'data', conn: m.conn!, data: fromBase64(m.d ?? '') };
      case 'failed':
        return { t: 'failed', conn: m.conn!, errno: m.errno ?? 118 };
      case 'resolved':
        return { t: 'resolved', name: m.name ?? '', ip: m.ip ?? null };
      default:
        return { t: m.t as 'connected' | 'closed', conn: m.conn! };
    }
  }

  /** The lab server is out of reach: every connection fails, every name is unknown. */
  private fail(e: unknown, ops: NetOp[] = []): void {
    if (!this.error) {
      this.error = e instanceof Error ? e.message : String(e);
      console.warn(`ESP32 virtual network: the lab server is unreachable (${this.error})`);
    }
    for (const op of ops) {
      if (op.t === 'connect') this.events.push({ t: 'failed', conn: op.conn, errno: 118 });
      if (op.t === 'resolve') this.events.push({ t: 'resolved', name: op.name, ip: null });
    }
  }

  send(ops: NetOp[]): void {
    if (ops.length === 0) return;
    if (!this.opened) this.open();
    const body = JSON.stringify({
      ops: ops.map((op) => (op.t === 'send' ? { t: 'send', conn: op.conn, d: toBase64(op.data) } : op)),
    });
    this.chain = this.chain.then(async () => {
      try {
        const res = await fetch(this.url('ops'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-esp32lab': '1' },
          body,
          signal: this.abort.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        if (!this.abort.signal.aborted) this.fail(e, ops);
      }
    });
  }

  take(): NetEvent[] {
    if (this.events.length === 0) return [];
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Drop every connection (the lab server closes them when the stream ends). */
  close(): void {
    this.abort.abort();
  }
}
