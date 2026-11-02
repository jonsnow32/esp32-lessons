// One click on the "Wi-Fi & Home Assistant" page sets up what lab boards need beyond lab_secrets.h:
//
//   1. the shared broker account "lab" on the box, over SSH (key, or the box password typed once
//      on the page: handed to ssh through SSH_ASKPASS, never stored, never on a command line);
//      its password is made up here and sent on ssh's stdin
//   2. lab_secrets.h with that account
//   3. a login to the box's broker with it
//   4. the bridge from the test broker on this computer (Homebrew mosquitto, where the emulator
//      publishes) to the box, in a block of mosquitto.conf the lab owns, then a restart
//
//   POST /api/lab-config/setup  { sshUser, sshPassword? }  ->  { ok, needPassword?, steps: [{ title, ok, detail }] }

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testBroker, type labConfigStore } from './labconfig';

export interface SetupStep {
  title: string;
  ok: boolean;
  detail: string;
}

export interface SetupResult {
  ok: boolean;
  /** SSH needs the box's password: ask for it and try again. */
  needPassword?: boolean;
  steps: SetupStep[];
}

const LAB_USER = 'lab';
const BEGIN = '# >>> ESP32 Lab: LabHA boards (written by the lab, edit in its settings page)';
const END = '# <<< ESP32 Lab';

/** Run on the box: the compose folder from the running container, else ~/home-server. */
const REMOTE = [
  'set -e',
  'IFS= read -r PASS',
  `dir=$(docker inspect mosquitto --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' 2>/dev/null || true)`,
  '[ -n "$dir" ] || dir="$HOME/home-server"',
  'cd "$dir"',
  `docker compose exec -T mosquitto mosquitto_passwd -b /mosquitto/config/passwd ${LAB_USER} "$PASS"`,
  // Mosquitto reads the password file again on SIGHUP: devices stay connected
  'docker compose kill -s HUP mosquitto >/dev/null',
  'echo "LAB-OK $dir"',
].join('\n');

/** The bridge block for mosquitto.conf; the listener too when the file has none of its own. */
export function bridgeBlock(host: string, port: number, password: string, withListener: boolean): string {
  return [
    BEGIN,
    ...(withListener ? ['# Local only: the lab and the emulator connect from this machine, without a password', 'listener 1883 127.0.0.1', 'allow_anonymous true', ''] : []),
    'connection home-server-lab',
    `address ${host}:${port}`,
    'remote_clientid lab-bridge',
    `remote_username ${LAB_USER}`,
    `remote_password ${password}`,
    'cleansession true',
    'notifications false',
    'restart_timeout 10 60',
    `topic home/${LAB_USER}/+/availability out 1`,
    `topic home/${LAB_USER}/+/+/state out 1`,
    `topic homeassistant/+/${LAB_USER}/# out 1`,
    `topic home/${LAB_USER}/+/+/set in 1`,
    'topic homeassistant/status in 1',
    END,
  ].join('\n');
}

/** `conf` with the lab's block put in (in place of an older one). */
export function withBridge(conf: string, host: string, port: number, password: string): string {
  const start = conf.indexOf(BEGIN);
  const end = conf.indexOf(END);
  const rest = start >= 0 && end > start ? conf.slice(0, start) + conf.slice(end + END.length) : conf;
  const hasListener = /^\s*listener\s/m.test(rest);
  return `${rest.trimEnd()}\n\n${bridgeBlock(host, port, password, !hasListener)}\n`;
}

function run(cmd: string, args: string[], input: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
    child.stdin.end(input);
  });
}

/** Create (or reset) the "lab" account on the box over SSH. */
async function createAccount(user: string, host: string, sshPassword: string | undefined, labPassword: string): Promise<{ ok: boolean; auth?: boolean; detail: string }> {
  const opts = ['-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'NumberOfPasswordPrompts=1'];
  const env: NodeJS.ProcessEnv = { ...process.env };
  let askDir: string | null = null;
  if (sshPassword) {
    // ssh reads the password from this helper, which prints it from its own environment
    askDir = mkdtempSync(join(tmpdir(), 'lab-ssh-'));
    const ask = join(askDir, 'askpass.sh');
    writeFileSync(ask, '#!/bin/sh\nprintf \'%s\\n\' "$LAB_SSH_PASSWORD"\n');
    chmodSync(ask, 0o700);
    Object.assign(env, { SSH_ASKPASS: ask, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: env.DISPLAY ?? ':0', LAB_SSH_PASSWORD: sshPassword });
  } else opts.push('-o', 'BatchMode=yes');
  try {
    const r = await run('ssh', [...opts, `${user}@${host}`, REMOTE], `${labPassword}\n`, env, 60000);
    const done = r.out.match(/LAB-OK (.*)/);
    if (r.code === 0 && done) return { ok: true, detail: `Tài khoản "${LAB_USER}" đã có trên box (${done[1]!.trim()}), broker đã nạp lại, thiết bị không bị ngắt.` };
    if (/Permission denied|Authentication failed|Too many authentication/i.test(r.out))
      return { ok: false, auth: true, detail: sshPassword ? 'Sai mật khẩu SSH hoặc tên người dùng trên box.' : 'Box cần mật khẩu SSH: nhập ở trên rồi bấm lại.' };
    if (/timed out|No route|Could not resolve|Connection refused/i.test(r.out)) return { ok: false, detail: `Không SSH được vào ${host}: ${r.out.trim().split('\n').pop()}` };
    if (/permission denied.*docker\.sock/i.test(r.out)) return { ok: false, detail: `User ${user} chưa được dùng docker: trên box chạy  sudo usermod -aG docker ${user}  rồi đăng nhập lại.` };
    return { ok: false, detail: `Lệnh trên box lỗi: ${r.out.trim().split('\n').slice(-3).join(' · ') || `mã ${r.code}`}` };
  } finally {
    if (askDir) rmSync(askDir, { recursive: true, force: true });
  }
}

/** Homebrew's mosquitto.conf, or null without Homebrew's mosquitto. */
function brewMosquitto(): { brew: string; conf: string } | null {
  for (const prefix of ['/opt/homebrew', '/usr/local']) {
    const brew = join(prefix, 'bin', 'brew');
    const conf = join(prefix, 'etc', 'mosquitto', 'mosquitto.conf');
    if (existsSync(brew) && existsSync(join(prefix, 'etc', 'mosquitto'))) return { brew, conf };
  }
  return null;
}

async function setupBridge(host: string, port: number, password: string): Promise<SetupStep> {
  const title = 'Bridge từ broker thử trên máy này lên box';
  const m = brewMosquitto();
  if (!m) return { title, ok: false, detail: 'Chưa có mosquitto của Homebrew trên máy này: chạy  brew install mosquitto  rồi bấm lại.' };
  const before = existsSync(m.conf) ? readFileSync(m.conf, 'utf8') : '';
  writeFileSync(m.conf, withBridge(before, host, port, password));
  const r = spawnSync(m.brew, ['services', 'restart', 'mosquitto'], { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) return { title, ok: false, detail: `Đã ghi ${m.conf} nhưng không khởi động lại được mosquitto: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}` };
  return { title, ok: true, detail: `Đã ghi khối ESP32 Lab vào ${m.conf} và khởi động lại mosquitto. Board giả lập (tên …-sim) giờ lên được Home Assistant.` };
}

export async function setupLab(store: ReturnType<typeof labConfigStore>, body: Record<string, unknown>): Promise<SetupResult> {
  const steps: SetupStep[] = [];
  const sshUser = typeof body.sshUser === 'string' ? body.sshUser.trim() : '';
  const sshPassword = typeof body.sshPassword === 'string' && body.sshPassword ? body.sshPassword : undefined;
  const cfg = store.current();
  if (!sshUser || !/^[a-z_][a-z0-9_.-]*$/i.test(sshUser)) return { ok: false, steps: [{ title: 'Đăng nhập box', ok: false, detail: 'Nhập tên người dùng SSH trên box (vd hungitlab).' }] };
  if (!cfg.mqttHost) return { ok: false, steps: [{ title: 'Đăng nhập box', ok: false, detail: 'Điền địa chỉ box ở phần broker và lưu trước.' }] };

  // Keep the lab account's password if it already has one: other boards may be using it
  const keep = cfg.mqttUser === LAB_USER && cfg.mqttPassword && cfg.mqttPassword !== 'FILL-IN';
  const password = keep ? cfg.mqttPassword : randomBytes(18).toString('base64url');

  const account = await createAccount(sshUser, cfg.mqttHost, sshPassword, password);
  steps.push({ title: `Tạo tài khoản "${LAB_USER}" trên box`, ok: account.ok, detail: account.detail });
  if (!account.ok) return { ok: false, needPassword: account.auth, steps };

  const error = store.save({ mqttUser: LAB_USER, mqttPassword: password });
  steps.push({ title: 'Lưu cấu hình lab', ok: !error, detail: error ?? `Tài khoản "${LAB_USER}" với mật khẩu mới đã ghi vào lab_secrets.h. Build lại board thật để nạp.` });
  if (error) return { ok: false, steps };

  let login = await testBroker({ host: cfg.mqttHost, port: cfg.mqttPort, user: LAB_USER, password });
  for (let i = 0; i < 3 && !login.ok; i++) {
    await new Promise((r) => setTimeout(r, 700));
    login = await testBroker({ host: cfg.mqttHost, port: cfg.mqttPort, user: LAB_USER, password });
  }
  steps.push({ title: 'Thử đăng nhập broker', ok: login.ok, detail: login.message });
  if (!login.ok) return { ok: false, steps };

  steps.push(await setupBridge(cfg.mqttHost, cfg.mqttPort, password));
  return { ok: steps.every((s) => s.ok), steps };
}
