// The settings every lab board shares through the course's lib/LabHA library: Wi-Fi and the
// broker, kept in lib/LabHA/src/lab_secrets.h (not in git). The settings page reads and writes
// that file here; the passwords never go back to the browser, only whether they are set.
//
//   GET  /api/lab-config        { available, exists, path, wifiSsid, mqttHost, mqttPort, mqttUser,
//                                 wifiPassword: bool, mqttPassword: bool }
//   PUT  /api/lab-config        { wifiSsid, wifiPassword?, mqttHost, mqttPort, mqttUser, mqttPassword? }
//                               a password left out (or empty) keeps the one in the file
//   POST /api/lab-config/test   { mqttHost?, mqttPort?, mqttUser?, mqttPassword? } over the file's:
//                               logs in to the broker once: { ok, message, ms }
//   POST /api/lab-config/setup  the account on the box and the bridge, in one go (labsetup.ts)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

export interface LabConfig {
  wifiSsid: string;
  wifiPassword: string;
  mqttHost: string;
  mqttPort: number;
  mqttUser: string;
  mqttPassword: string;
}

export interface LabConfigView extends Omit<LabConfig, 'wifiPassword' | 'mqttPassword'> {
  /** lib/LabHA is in the course. */
  available: boolean;
  /** lab_secrets.h is there. */
  exists: boolean;
  /** lab_secrets.h, relative to the course. */
  path: string;
  wifiPassword: boolean;
  mqttPassword: boolean;
}

const REL = 'lib/LabHA/src/lab_secrets.h';
const DEFAULTS: LabConfig = { wifiSsid: '', wifiPassword: '', mqttHost: '', mqttPort: 1883, mqttUser: 'lab', mqttPassword: '' };

const unquote = (s: string) => s.replace(/\\(.)/g, '$1');
const quote = (s: string) => `"${s.replace(/[\\"]/g, '\\$&')}"`;

/** The settings in a lab_secrets.h text, the defaults for what it lacks. */
export function parseLabSecrets(text: string): LabConfig {
  const str = (name: string, d: string) => {
    const m = text.match(new RegExp(`^\\s*#define\\s+${name}\\s+"((?:[^"\\\\]|\\\\.)*)"`, 'm'));
    return m ? unquote(m[1]!) : d;
  };
  const port = Number(text.match(/^\s*#define\s+LAB_MQTT_PORT\s+(\d+)/m)?.[1]);
  return {
    wifiSsid: str('LAB_WIFI_SSID', DEFAULTS.wifiSsid),
    wifiPassword: str('LAB_WIFI_PASSWORD', DEFAULTS.wifiPassword),
    mqttHost: str('LAB_MQTT_HOST', DEFAULTS.mqttHost),
    mqttPort: port > 0 && port < 65536 ? port : DEFAULTS.mqttPort,
    mqttUser: str('LAB_MQTT_USER', DEFAULTS.mqttUser),
    mqttPassword: str('LAB_MQTT_PASSWORD', DEFAULTS.mqttPassword),
  };
}

/** lab_secrets.h for these settings. */
export function labSecretsText(c: LabConfig): string {
  return [
    '// Wi-Fi and broker for every lab board (not committed; template: lab_secrets.example.h)',
    '// Written by ESP32 Lab\'s "Wi-Fi & Home Assistant" page: edit it there or here',
    '#pragma once',
    '',
    `#define LAB_WIFI_SSID ${quote(c.wifiSsid)}`,
    `#define LAB_WIFI_PASSWORD ${quote(c.wifiPassword)}`,
    '',
    `#define LAB_MQTT_HOST ${quote(c.mqttHost)}`,
    `#define LAB_MQTT_PORT ${c.mqttPort}`,
    '// One broker account shared by every lab board: the box\'s ACL keeps it under home/lab/# and',
    '// homeassistant/+/lab/#. Create it once on the box:',
    '//   docker compose exec mosquitto mosquitto_passwd /mosquitto/config/passwd lab',
    '//   docker compose restart mosquitto',
    `#define LAB_MQTT_USER ${quote(c.mqttUser)}`,
    `#define LAB_MQTT_PASSWORD ${quote(c.mqttPassword)}`,
    '',
  ].join('\n');
}

/** A placeholder from the template is not a password. */
const isSet = (p: string) => !!p && p !== 'FILL-IN' && p !== 'lab-password' && p !== 'your-wifi-password';

export function labConfigStore(projectRoot: string) {
  const file = join(projectRoot, REL);
  const available = () => existsSync(join(projectRoot, 'lib', 'LabHA'));
  const current = (): LabConfig => (existsSync(file) ? parseLabSecrets(readFileSync(file, 'utf8')) : { ...DEFAULTS });

  function view(): LabConfigView {
    const c = current();
    return { ...c, available: available(), exists: existsSync(file), path: REL, wifiPassword: isSet(c.wifiPassword), mqttPassword: isSet(c.mqttPassword) };
  }

  /** Write what the page sent; null when it is not valid, with the reason. */
  function save(body: Record<string, unknown>): string | null {
    if (!available()) return 'Không thấy thư viện lib/LabHA trong khoá học.';
    const c = current();
    const text = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : undefined);
    const next: LabConfig = {
      wifiSsid: text('wifiSsid') ?? c.wifiSsid,
      wifiPassword: text('wifiPassword') || c.wifiPassword,
      mqttHost: text('mqttHost') ?? c.mqttHost,
      mqttPort: body.mqttPort === undefined ? c.mqttPort : Number(body.mqttPort),
      mqttUser: text('mqttUser') ?? c.mqttUser,
      mqttPassword: text('mqttPassword') || c.mqttPassword,
    };
    if (!next.wifiSsid) return 'Thiếu tên Wi-Fi.';
    if (next.wifiSsid.length > 32) return 'Tên Wi-Fi dài tối đa 32 ký tự.';
    if (next.wifiPassword && (next.wifiPassword.length < 8 || next.wifiPassword.length > 63)) return 'Mật khẩu Wi-Fi WPA dài 8–63 ký tự.';
    if (!/^[A-Za-z0-9.-]+$/.test(next.mqttHost)) return 'Địa chỉ broker không hợp lệ (IP hoặc tên máy).';
    if (!Number.isInteger(next.mqttPort) || next.mqttPort < 1 || next.mqttPort > 65535) return 'Cổng broker phải từ 1 đến 65535.';
    if (!next.mqttUser) return 'Thiếu tài khoản MQTT.';
    writeFileSync(file, labSecretsText(next));
    return null;
  }

  /** The settings to test: what the page has typed over what the file holds. */
  function forTest(body: Record<string, unknown>) {
    const c = current();
    const text = (k: string) => (typeof body[k] === 'string' && (body[k] as string).trim()) || undefined;
    return {
      host: text('mqttHost') ?? c.mqttHost,
      port: body.mqttPort ? Number(body.mqttPort) : c.mqttPort,
      user: text('mqttUser') ?? c.mqttUser,
      password: text('mqttPassword') ?? c.mqttPassword,
    };
  }

  return { view, save, forTest, current };
}

/** An MQTT 3.1.1 string: two bytes of length, then UTF-8. */
function mqttString(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length);
  return Buffer.concat([len, b]);
}

/** One MQTT 3.1.1 CONNECT packet with user and password. */
export function connectPacket(clientId: string, user: string, password: string): Buffer {
  const header = Buffer.concat([mqttString('MQTT'), Buffer.from([4, (user ? 0x80 : 0) | (password ? 0x40 : 0) | 0x02, 0, 10])]);
  const payload = Buffer.concat([mqttString(clientId), ...(user ? [mqttString(user)] : []), ...(password ? [mqttString(password)] : [])]);
  let n = header.length + payload.length;
  const len: number[] = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    len.push(byte);
  } while (n > 0);
  return Buffer.concat([Buffer.from([0x10, ...len]), header, payload]);
}

const CONNACK: Record<number, string> = {
  1: 'Broker không nhận phiên bản MQTT 3.1.1.',
  2: 'Broker từ chối client id.',
  3: 'Broker đang không phục vụ.',
  4: 'Sai tài khoản hoặc mật khẩu: tạo tài khoản trên box (lệnh bên dưới) rồi điền đúng mật khẩu.',
  5: 'Broker không cho tài khoản này đăng nhập: tạo tài khoản trên box (lệnh bên dưới) rồi điền đúng mật khẩu.',
};

/** Log in to the broker once, as a lab board would, and say how it went. */
export function testBroker(t: { host: string; port: number; user: string; password: string }, timeoutMs = 5000): Promise<{ ok: boolean; message: string; ms: number }> {
  const started = Date.now();
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean, message: string) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok, message, ms: Date.now() - started });
    };
    if (!t.host) return resolve({ ok: false, message: 'Chưa có địa chỉ broker.', ms: 0 });
    const socket = connect({ host: t.host, port: t.port });
    socket.setTimeout(timeoutMs, () => finish(false, `Không có phản hồi từ ${t.host}:${t.port} sau ${timeoutMs / 1000} s: box có đang bật, cùng mạng với máy này không?`));
    socket.on('error', (e: NodeJS.ErrnoException) =>
      finish(false, e.code === 'ECONNREFUSED' ? `${t.host}:${t.port} từ chối kết nối: mosquitto trên box có đang chạy không?` : e.code === 'ENOTFOUND' ? `Không tìm thấy máy ${t.host}.` : `Không kết nối được ${t.host}:${t.port} (${e.code ?? e.message}).`),
    );
    socket.on('connect', () => socket.write(connectPacket(`lab-config-test-${process.pid}`, t.user, t.password)));
    let got = Buffer.alloc(0);
    socket.on('data', (d) => {
      got = Buffer.concat([got, d]);
      if (got.length < 4) return;
      if (got[0] !== 0x20) return finish(false, 'Máy ở địa chỉ này không trả lời như một broker MQTT.');
      const rc = got[3]!;
      if (rc === 0) {
        socket.write(Buffer.from([0xe0, 0]));  // DISCONNECT
        finish(true, `Đăng nhập broker ${t.host}:${t.port} bằng tài khoản "${t.user}" được.`);
      } else finish(false, CONNACK[rc] ?? `Broker từ chối (mã ${rc}).`);
    });
    socket.on('close', () => finish(false, 'Broker đóng kết nối ngay.'));
  });
}
