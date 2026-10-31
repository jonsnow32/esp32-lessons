// The lab's AI assistant through the Claude Code CLI on this machine, so it runs on the user's own
// Claude login instead of an API key. Registered by the Vite dev server, and by the desktop app
// when it is turned on there (ESP32LAB_CLAUDE_CODE=1, see desktop/src/main.ts); a web build never
// serves it.
//
//   GET  /api/ai/claude                                  { available: boolean }
//   POST /api/ai/claude { prompt, system, model, session? }
//        streams one JSON object per line: { type: 'session', id } | { type: 'text', text }
//        | { type: 'error', message } | { type: 'done' }
//
// Claude Code runs headless with every tool turned off and no settings, MCP servers or CLAUDE.md
// loaded: it only answers from what the prompt carries. A conversation goes on with --resume.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

type Next = (err?: unknown) => void;

export interface ClaudeCliOptions {
  /** Empty folder the CLI runs in, so it picks up no project instructions. */
  workDir: string;
}

/**
 * The PATH of the user's login shell. An app opened from the Finder or the Dock gets a bare one
 * (/usr/bin:/bin:…) without where `claude` and the node it may run on were installed.
 */
function loginPath(): string | undefined {
  if (process.platform === 'win32') return undefined;
  const r = spawnSync(process.env.SHELL || '/bin/sh', ['-ilc', 'printf "<<%s>>" "$PATH"'], { encoding: 'utf8', timeout: 5000 });
  return /<<(.*)>>/.exec(r.stdout ?? '')?.[1] || undefined;
}

/** The claude command and the environment to run it in, or null if it is not on this computer. */
function findClaude(): { command: string; env: NodeJS.ProcessEnv } | null {
  const home = homedir();
  const login = loginPath();
  const dirs = [...new Set([...(login ?? '').split(delimiter), ...(process.env.PATH ?? '').split(delimiter)].filter(Boolean))];
  const env = { ...process.env, PATH: dirs.join(delimiter) };
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  // The native installer's places, then npm's and Homebrew's
  const places = [join(home, '.local', 'bin', exe), join(home, '.claude', 'local', exe), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  for (const command of ['claude', ...places.filter((p) => existsSync(p))]) {
    if (spawnSync(command, ['--version'], { stdio: 'ignore', env, timeout: 15000 }).status === 0) {
      // Its own folder first: an npm install runs on the node beside it
      return { command, env: command === 'claude' ? env : { ...env, PATH: [dirname(command), ...dirs].join(delimiter) } };
    }
  }
  return null;
}

export function claudeCli(opts: ClaudeCliOptions) {
  let found: ReturnType<typeof findClaude> | undefined;
  const claude = () => (found === undefined ? (found = findClaude()) : found);
  const isAvailable = () => claude() !== null;

  function ask(req: IncomingMessage, res: ServerResponse) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let input: { prompt: string; system: string; model: string; session?: string };
      try {
        const b = JSON.parse(body);
        input = { prompt: String(b.prompt), system: String(b.system), model: String(b.model), session: b.session ? String(b.session) : undefined };
      } catch {
        res.statusCode = 400;
        return res.end('bad request');
      }
      res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      const out = (o: object) => res.write(JSON.stringify(o) + '\n');

      mkdirSync(opts.workDir, { recursive: true });
      const args = [
        '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        '--tools', '', '--setting-sources', '', '--strict-mcp-config',
        '--system-prompt', input.system, '--model', input.model,
        ...(input.session ? ['--resume', input.session] : []),
      ];
      const { command, env } = claude() ?? { command: 'claude', env: process.env };
      const child = spawn(command, args, { cwd: opts.workDir, env, stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdin.end(input.prompt);
      // The browser stopped the answer (or went away): stop the CLI too
      res.on('close', () => child.exitCode === null && child.kill());

      let pending = '';
      let stderr = '';
      let failed = false;
      child.stdout.on('data', (chunk: Buffer) => {
        pending += chunk.toString('utf8');
        const lines = pending.split('\n');
        pending = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          let m: any;
          try {
            m = JSON.parse(line);
          } catch {
            continue;
          }
          if (m.type === 'system' && m.subtype === 'init') out({ type: 'session', id: m.session_id });
          else if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') out({ type: 'text', text: m.event.delta.text });
          else if (m.type === 'result' && m.is_error) {
            failed = true;
            out({ type: 'error', message: String(m.result ?? m.subtype ?? 'Claude Code báo lỗi') });
          }
        }
      });
      child.stderr.on('data', (c: Buffer) => (stderr = (stderr + c.toString('utf8')).slice(-4000)));
      child.on('error', (e) => {
        failed = true;
        out({ type: 'error', message: `Không chạy được lệnh claude: ${e.message}` });
      });
      child.on('close', (code) => {
        if (code && !failed) out({ type: 'error', message: stderr.trim() || `claude thoát với mã ${code}` });
        out({ type: 'done' });
        res.end();
      });
    });
  }

  /** Connect-style handler for /api/ai/claude; passes anything else to `next`. */
  function handle(req: IncomingMessage, res: ServerResponse, next: Next) {
    if (new URL(req.url ?? '/', 'http://lab').pathname !== '/api/ai/claude') return next();
    if (req.method === 'GET') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ available: isAvailable() }));
    }
    if (req.method === 'POST') return ask(req, res);
    next();
  }

  return { handle };
}
