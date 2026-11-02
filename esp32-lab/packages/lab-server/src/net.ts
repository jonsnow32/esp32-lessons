// The emulator's virtual network on this machine: the firmware's TCP connections and DNS
// lookups, opened for real (see packages/mcu-esp32/src/net.ts for the browser side).
//
//   GET  /api/net/events?s=<session>   newline-delimited JSON events for as long as the request
//                                      stays open; closing it drops the session's connections:
//                                      {t:'connected',conn} {t:'data',conn,d:base64} {t:'closed',conn}
//                                      {t:'failed',conn,errno} {t:'resolved',name,ip}
//   POST /api/net/ops?s=<session>      { ops: [{t:'connect',conn,ip,port} | {t:'send',conn,d:base64}
//                                      | {t:'close',conn} | {t:'resolve',name}] }
//
// 10.0.2.2, the virtual gateway, is this machine (as in QEMU): a broker or web server running
// here is reachable from the firmware at that address.
//
// Both requests must carry the header x-esp32lab: a page from another site cannot add it
// without a CORS preflight this server never grants, so it cannot use the lab to open
// connections into the local network.

import { lookup } from 'node:dns/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';

const GATEWAY = '10.0.2.2';
const CONNECT_TIMEOUT_MS = 5000;
/** newlib errno values the firmware expects. */
const ERRNO: Record<string, number> = { ECONNREFUSED: 111, ETIMEDOUT: 116, ECONNRESET: 104, EHOSTUNREACH: 118, ENETUNREACH: 118 };

interface Session {
  res: ServerResponse | null;
  /** Events written before the stream opened. */
  queue: string[];
  socks: Map<number, Socket>;
}

type Next = (err?: unknown) => void;
type Op = { t: 'connect'; conn: number; ip: string; port: number } | { t: 'send'; conn: number; d: string } | { t: 'close'; conn: number } | { t: 'resolve'; name: string };

export function netRelay() {
  const sessions = new Map<string, Session>();

  const session = (id: string): Session => {
    let s = sessions.get(id);
    if (!s) sessions.set(id, (s = { res: null, queue: [], socks: new Map() }));
    return s;
  };

  const emit = (s: Session, event: object) => {
    const line = JSON.stringify(event) + '\n';
    if (s.res) s.res.write(line);
    else s.queue.push(line);
  };

  function open(s: Session, conn: number, ip: string, port: number) {
    const sock = connect({ host: ip === GATEWAY ? '127.0.0.1' : ip, port });
    s.socks.set(conn, sock);
    sock.setNoDelay(true);
    let connected = false;
    const timer = setTimeout(() => sock.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), CONNECT_TIMEOUT_MS);
    sock.on('connect', () => {
      clearTimeout(timer);
      connected = true;
      emit(s, { t: 'connected', conn });
    });
    sock.on('data', (d) => emit(s, { t: 'data', conn, d: d.toString('base64') }));
    sock.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (s.socks.get(conn) !== sock) return;
      s.socks.delete(conn);
      emit(s, { t: 'failed', conn, errno: ERRNO[e.code ?? ''] ?? (connected ? 104 : 118) });
    });
    sock.on('close', () => {
      clearTimeout(timer);
      if (s.socks.get(conn) !== sock) return;
      s.socks.delete(conn);
      emit(s, { t: 'closed', conn });
    });
  }

  function apply(s: Session, op: Op) {
    switch (op.t) {
      case 'connect':
        if (typeof op.ip === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(op.ip) && Number.isInteger(op.port)) open(s, op.conn, op.ip, op.port);
        else emit(s, { t: 'failed', conn: op.conn, errno: 118 });
        return;
      case 'send':
        s.socks.get(op.conn)?.write(Buffer.from(String(op.d ?? ''), 'base64'));
        return;
      case 'close': {
        const sock = s.socks.get(op.conn);
        s.socks.delete(op.conn);
        sock?.end();
        sock?.setTimeout(2000, () => sock.destroy());
        return;
      }
      case 'resolve':
        lookup(String(op.name), { family: 4 }).then(
          (r) => emit(s, { t: 'resolved', name: op.name, ip: r.address }),
          () => emit(s, { t: 'resolved', name: op.name, ip: null }),
        );
    }
  }

  function drop(id: string) {
    const s = sessions.get(id);
    if (!s) return;
    sessions.delete(id);
    for (const sock of s.socks.values()) sock.destroy();
  }

  /** Connect-style handler for /api/net/…; anything else goes to `next`. */
  function handle(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams, next: Next) {
    const id = query.get('s') ?? '';
    if (!req.headers['x-esp32lab'] || !/^[\w-]{8,64}$/.test(id)) {
      res.statusCode = 403;
      return res.end();
    }
    if (req.method === 'GET' && path === '/events') {
      const s = session(id);
      s.res?.end();
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
      res.flushHeaders();
      s.res = res;
      for (const line of s.queue.splice(0)) res.write(line);
      req.on('close', () => {
        if (s.res === res) drop(id);
      });
      return;
    }
    if (req.method === 'POST' && path === '/ops') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        let ops: Op[];
        try {
          ops = JSON.parse(Buffer.concat(chunks).toString('utf8')).ops;
          if (!Array.isArray(ops)) throw new Error('ops');
        } catch {
          res.statusCode = 400;
          return res.end();
        }
        const s = session(id);
        for (const op of ops) apply(s, op);
        res.end('ok');
      });
      return;
    }
    next();
  }

  return { handle };
}
