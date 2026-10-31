// Dev only: the lab's AI assistant through the Claude Code CLI on this machine, so it runs on the
// developer's own Claude subscription instead of an API key. Registered by the Vite dev server
// alone; the desktop app and any other build never serve it.
//
//   GET  /api/ai/claude                                  { available: boolean }
//   POST /api/ai/claude { prompt, system, model, session? }
//        streams one JSON object per line: { type: 'session', id } | { type: 'text', text }
//        | { type: 'error', message } | { type: 'done' }
//
// Claude Code runs headless with every tool turned off and no settings, MCP servers or CLAUDE.md
// loaded: it only answers from what the prompt carries. A conversation goes on with --resume.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';

type Next = (err?: unknown) => void;

export interface ClaudeCliOptions {
  /** Empty folder the CLI runs in, so it picks up no project instructions. */
  workDir: string;
}

export function claudeCli(opts: ClaudeCliOptions) {
  let available: boolean | null = null;
  const isAvailable = () => (available ??= spawnSync('claude', ['--version'], { stdio: 'ignore' }).status === 0);

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
      const child = spawn('claude', args, { cwd: opts.workDir, stdio: ['pipe', 'pipe', 'pipe'] });
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
