import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectPacket, labConfigStore, labSecretsText, parseLabSecrets, testBroker } from '../packages/lab-server/src/labconfig';
import { withBridge } from '../packages/lab-server/src/labsetup';

const course = () => {
  const root = mkdtempSync(join(tmpdir(), 'labcfg-'));
  mkdirSync(join(root, 'lib', 'LabHA', 'src'), { recursive: true });
  return root;
};

describe('lab config (lib/LabHA/src/lab_secrets.h)', () => {
  it('reads back what it writes, quotes and backslashes too', () => {
    const c = { wifiSsid: 'Nhà "A"', wifiPassword: 'p\\ss word', mqttHost: '192.168.1.251', mqttPort: 1884, mqttUser: 'lab', mqttPassword: 'x' };
    expect(parseLabSecrets(labSecretsText(c))).toEqual(c);
  });

  it('never shows the passwords, keeps them when left empty, refuses bad settings', () => {
    const root = course();
    const store = labConfigStore(root);
    expect(store.view()).toMatchObject({ available: true, exists: false, wifiPassword: false, mqttUser: 'lab' });
    expect(store.save({ wifiSsid: 'home', wifiPassword: 'secret123', mqttHost: '10.0.0.5', mqttPort: 1883, mqttUser: 'lab', mqttPassword: 'm' })).toBeNull();
    const v = store.view();
    expect(v).toMatchObject({ exists: true, wifiSsid: 'home', wifiPassword: true, mqttPassword: true });
    expect(JSON.stringify(v)).not.toContain('secret123');
    expect(store.save({ wifiSsid: 'home2', wifiPassword: '', mqttPassword: '' })).toBeNull();
    const file = readFileSync(join(root, 'lib/LabHA/src/lab_secrets.h'), 'utf8');
    expect(file).toContain('#define LAB_WIFI_SSID "home2"');
    expect(file).toContain('#define LAB_WIFI_PASSWORD "secret123"');
    expect(store.save({ wifiPassword: 'short' })).toMatch(/8–63/);
    expect(store.save({ mqttHost: 'a b' })).toMatch(/broker/);
    expect(store.save({ mqttPort: 70000 })).toMatch(/Cổng/);
  });

  it('a template placeholder is not a saved password', () => {
    const root = course();
    writeFileSync(join(root, 'lib/LabHA/src/lab_secrets.h'), labSecretsText({ wifiSsid: 'w', wifiPassword: 'abcdefgh', mqttHost: 'h', mqttPort: 1883, mqttUser: 'lab', mqttPassword: 'FILL-IN' }));
    expect(labConfigStore(root).view()).toMatchObject({ wifiPassword: true, mqttPassword: false });
  });

  it('logs in to a broker with an MQTT 3.1.1 CONNECT and reads its CONNACK', async () => {
    const p = connectPacket('id', 'lab', 'pw');
    expect(p[0]).toBe(0x10);
    expect(p[1]).toBe(p.length - 2);
    expect(p.subarray(2, 8).toString('latin1')).toBe('\0\x04MQTT');
    expect(p[9]).toBe(0xc2); // user, password, clean session
    for (const [rc, ok] of [[0, true], [4, false]] as const) {
      const server = createServer((s) => s.once('data', () => s.write(Buffer.from([0x20, 2, 0, rc]))));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const port = (server.address() as { port: number }).port;
      const r = await testBroker({ host: '127.0.0.1', port, user: 'lab', password: 'pw' });
      server.close();
      expect(r.ok).toBe(ok);
      if (!ok) expect(r.message).toMatch(/mật khẩu/);
    }
    const refused = await testBroker({ host: '127.0.0.1', port: 1, user: 'lab', password: 'pw' });
    expect(refused.ok).toBe(false);
  });
});

describe('lab bridge block in mosquitto.conf', () => {
  const user = 'listener 1883 127.0.0.1\nallow_anonymous true\n\nconnection home-server\nremote_username esp32-den-lab\n';
  it('adds its block once, keeps the rest, replaces itself on a second run', () => {
    const once = withBridge(user, '192.168.1.251', 1883, 'p1');
    expect(once.startsWith(user.trimEnd())).toBe(true);
    expect(once).toContain('connection home-server-lab');
    expect(once).toContain('remote_password p1');
    expect(once.match(/listener/g)).toHaveLength(1);
    const twice = withBridge(once, '192.168.1.251', 1883, 'p2');
    expect(twice.match(/connection home-server-lab/g)).toHaveLength(1);
    expect(twice).toContain('remote_password p2');
    expect(twice).not.toContain('p1');
    expect(twice).toContain('connection home-server\n');
  });
  it('brings its own listener into an empty file', () => {
    expect(withBridge('', 'h', 1883, 'p')).toContain('listener 1883 127.0.0.1');
  });
});
