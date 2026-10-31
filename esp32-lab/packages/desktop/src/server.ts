// The desktop app's server, on a random port of 127.0.0.1: the built web app, the first-launch
// setup page and the lab's endpoints (see lab-server). The window never talks to it directly:
// it loads app://lab/…, which the main process forwards here with a secret token, so other
// programs and web pages on the computer cannot use it.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, relative } from 'node:path';
import type { claudeCli } from '../../lab-server/src/claude-cli';
import type { labServer } from '../../lab-server/src/index';
import { SETUP_STEPS, type ToolchainSetup } from './toolchain';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export const TOKEN_HEADER = 'x-esp32lab-token';

export interface DesktopServerOptions {
  /** The built web app (vite build). */
  webDir: string;
  /** The setup page and its files. */
  setupDir: string;
  lab: ReturnType<typeof labServer>;
  setup: ToolchainSetup;
  /** The AI assistant through Claude Code on this computer, when it is turned on (see main.ts). */
  claude?: ReturnType<typeof claudeCli>;
}

/** A file under `root`, or undefined if the path leaves it or there is none. */
function fileIn(root: string, path: string): string | undefined {
  const full = normalize(join(root, path));
  if (relative(root, full).startsWith('..')) return undefined;
  return existsSync(full) && statSync(full).isFile() ? full : undefined;
}

function sendFile(res: ServerResponse, file: string) {
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}

export async function startServer(opts: DesktopServerOptions): Promise<{ port: number; token: string }> {
  const token = randomBytes(24).toString('hex');

  function setupRoutes(req: IncomingMessage, res: ServerResponse, path: string): boolean {
    if (path === '/setup/steps') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(SETUP_STEPS));
      return true;
    }
    if (path === '/setup/events') {
      // Server-sent events: the setup so far, then as it goes
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      const off = opts.setup.subscribe((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
      req.on('close', off);
      return true;
    }
    if (path === '/setup/start' && req.method === 'POST') {
      void opts.setup.install();
      res.end('ok');
      return true;
    }
    return false;
  }

  const server = createServer((req, res) => {
    if (req.headers[TOKEN_HEADER] !== token) {
      res.statusCode = 403;
      return res.end();
    }
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://lab').pathname);
    if (setupRoutes(req, res, path)) return;
    const lab = () => opts.lab.handle(req, res, () => {
      const file = fileIn(opts.setupDir, path) ?? fileIn(opts.webDir, path);
      if (file && req.method === 'GET') return sendFile(res, file);
      // Anything else is a page of the app
      const index = join(opts.webDir, 'index.html');
      if (req.method === 'GET' && !extname(path) && existsSync(index)) return sendFile(res, index);
      res.statusCode = 404;
      res.end();
    });
    if (opts.claude) opts.claude.handle(req, res, lab);
    else lab();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, token };
}
