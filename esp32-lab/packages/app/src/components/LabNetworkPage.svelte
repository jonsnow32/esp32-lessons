<script lang="ts">
  // Wi-Fi and the Home Assistant broker every lab board shares (in a DocSheet): the form over
  // lib/LabHA/src/lab_secrets.h through /api/lab-config, a broker login test, the one-off
  // commands for the box, and the code a new board needs, with its topics and its device in HA.
  import DocSheet from './DocSheet.svelte';
  import Icon from './Icon.svelte';

  interface View {
    available: boolean;
    exists: boolean;
    path: string;
    wifiSsid: string;
    mqttHost: string;
    mqttPort: number;
    mqttUser: string;
    wifiPassword: boolean;
    mqttPassword: boolean;
  }

  let view = $state<View | null>(null);
  let loadError = $state<string | null>(null);
  // The form; passwords stay empty unless typed: empty keeps the saved one
  let wifiSsid = $state('');
  let wifiPassword = $state('');
  let mqttHost = $state('');
  let mqttPort = $state(1883);
  let mqttUser = $state('lab');
  let mqttPassword = $state('');
  let showWifi = $state(false);
  let showMqtt = $state(false);

  let saving = $state(false);
  let saved = $state<{ ok: boolean; text: string } | null>(null);
  let testing = $state(false);
  let test = $state<{ ok: boolean; message: string; ms: number } | null>(null);

  function fill(v: View) {
    view = v;
    wifiSsid = v.wifiSsid;
    mqttHost = v.mqttHost;
    mqttPort = v.mqttPort;
    mqttUser = v.mqttUser;
    wifiPassword = mqttPassword = '';
  }

  async function load() {
    try {
      const r = await fetch('/api/lab-config', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      fill(await r.json());
    } catch {
      loadError = 'Không đọc được cấu hình: trang này cần server của lab (pnpm dev hoặc app desktop).';
    }
  }
  void load();

  let dirty = $derived(
    !!view && (wifiSsid !== view.wifiSsid || mqttHost !== view.mqttHost || mqttPort !== view.mqttPort || mqttUser !== view.mqttUser || !!wifiPassword || !!mqttPassword),
  );

  async function save(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    saved = null;
    try {
      const r = await fetch('/api/lab-config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wifiSsid, wifiPassword, mqttHost, mqttPort: Number(mqttPort), mqttUser, mqttPassword }),
      });
      const body = await r.json();
      if (!r.ok) saved = { ok: false, text: body.error ?? 'Không lưu được.' };
      else {
        fill(body);
        saved = { ok: true, text: `Đã lưu vào ${body.path}. Build lại board để nạp cấu hình mới.` };
      }
    } catch {
      saved = { ok: false, text: 'Không lưu được: server của lab không trả lời.' };
    } finally {
      saving = false;
    }
  }

  async function runTest() {
    testing = true;
    test = null;
    try {
      const r = await fetch('/api/lab-config/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mqttHost, mqttPort: Number(mqttPort), mqttUser, mqttPassword }),
      });
      test = await r.json();
    } catch {
      test = { ok: false, message: 'Server của lab không trả lời.', ms: 0 };
    } finally {
      testing = false;
    }
  }

  // A new board: its name, cleaned the way LabHA does
  let boardName = $state('tuoi-cay');
  let id = $derived(boardName.trim().replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 35) || 'ten-board');
  let code = $derived(`#include <Arduino.h>
#include <LabHA.h>

LabHA ha("${id}");  // Wi-Fi và broker lấy từ lab_secrets.h

void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
  ha.addSwitch("led", "Đèn", [](bool on) { digitalWrite(2, on); });
  ha.addSensor("moisture", "Độ ẩm đất", "%", "moisture");
  ha.begin();
}

void loop() {
  ha.loop();
  static unsigned long last = 0;
  if (millis() - last >= 10000) {
    last = millis();
    ha.publish("moisture", 42);  // giá trị đọc từ cảm biến
  }
}
`);
  let commands = $derived(`cd ~/home-server
docker compose exec mosquitto mosquitto_passwd /mosquitto/config/passwd lab
docker compose kill -s HUP mosquitto`);

  // One-click setup: the "lab" account on the box over SSH, lab_secrets.h, the bridge on this computer
  interface Step { title: string; ok: boolean; detail: string }
  const SSH_USER_KEY = 'esp32lab.boxSshUser';
  let sshUser = $state(localStorage.getItem(SSH_USER_KEY) ?? '');
  let sshPassword = $state('');
  let needPassword = $state(false);
  let settingUp = $state(false);
  let setup = $state<{ ok: boolean; steps: Step[] } | null>(null);
  let ready = $derived(!!view && view.mqttUser === 'lab' && view.mqttPassword);

  async function runSetup(e: SubmitEvent) {
    e.preventDefault();
    settingUp = true;
    setup = null;
    localStorage.setItem(SSH_USER_KEY, sshUser.trim());
    try {
      const r = await fetch('/api/lab-config/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sshUser: sshUser.trim(), sshPassword }) });
      const body = await r.json();
      setup = body;
      needPassword = !!body.needPassword || needPassword;
      if (body.ok) sshPassword = '';
      await load();
    } catch {
      setup = { ok: false, steps: [{ title: 'Thiết lập', ok: false, detail: 'Server của lab không trả lời.' }] };
    } finally {
      settingUp = false;
    }
  }

  let copied = $state<string | null>(null);
  async function copy(what: string, text: string) {
    await navigator.clipboard.writeText(text);
    copied = what;
    setTimeout(() => copied === what && (copied = null), 1500);
  }
</script>

<DocSheet title="Wi-Fi & Home Assistant" kind="Cấu hình lab" siblings={[]}>
  <section class="intro">
    <h1>Wi-Fi & Home Assistant cho mọi board</h1>
    <p>
      Board nào dùng thư viện <code>LabHA</code> cũng lấy Wi-Fi và broker từ đây, nên dự án mới không phải cấu hình lại. Cấu hình nằm
      trong <code>{view?.path ?? 'lib/LabHA/src/lab_secrets.h'}</code> trên máy này, không vào git. Mật khẩu không bao giờ hiện lại trên trang.
    </p>
    {#if view}
      <div class="chips">
        <span class="chip" class:good={view.exists} class:bad={!view.exists}>{view.exists ? 'Đã có file cấu hình' : 'Chưa có file cấu hình'}</span>
        <span class="chip" class:good={view.wifiPassword} class:bad={!view.wifiPassword}>Mật khẩu Wi-Fi {view.wifiPassword ? 'đã lưu' : 'chưa có'}</span>
        <span class="chip" class:good={view.mqttPassword} class:bad={!view.mqttPassword}>Mật khẩu MQTT {view.mqttPassword ? 'đã lưu' : 'chưa có'}</span>
      </div>
    {/if}
  </section>

  {#if loadError}
    <section><p class="msg bad">{loadError}</p></section>
  {:else if view && !view.available}
    <section><p class="msg bad">Không thấy thư viện <code>lib/LabHA</code> trong khoá học, nên chưa có gì để cấu hình.</p></section>
  {:else if view}
    <section class="setup" class:done={ready}>
      <h2>Kết nối với box <span class="sub">một lần, lab tự làm hết</span></h2>
      <p class="hint">
        Lab đăng nhập SSH vào box để tạo tài khoản broker <code>lab</code> dùng chung cho mọi board (ACL sẵn có chỉ cho nó ghi trong <code>home/lab/#</code>,
        không đụng được thiết bị thật), tự đặt và lưu mật khẩu của nó vào cấu hình bên dưới, rồi dựng bridge từ broker thử trên máy này lên box để board giả lập cũng hiện trong Home Assistant.
        Mật khẩu SSH chỉ dùng cho lần này, không lưu ở đâu.
      </p>
      {#if ready && !setup}<p class="msg good"><Icon name="check" size={14} />Đã thiết lập: các board dùng tài khoản <code>lab</code>. Bấm lại nếu cần dựng lại bridge.</p>{/if}
      <form class="sshform" onsubmit={runSetup}>
        <label>Người dùng SSH trên box<input bind:value={sshUser} required placeholder="vd hungitlab" spellcheck="false" autocomplete="username" /></label>
        <label>Mật khẩu SSH {needPassword ? '' : '(nếu box không dùng key)'}<input type="password" bind:value={sshPassword} autocomplete="current-password" placeholder="Không lưu" /></label>
        <button class="primary" type="submit" disabled={settingUp || !sshUser.trim() || !mqttHost}>{settingUp ? 'Đang thiết lập…' : ready ? 'Thiết lập lại' : 'Thiết lập tự động'}</button>
      </form>
      {#if setup}
        <ol class="steps">
          {#each setup.steps as st}
            <li class:good={st.ok} class:bad={!st.ok}><b>{st.ok ? '✓' : '✗'} {st.title}</b><span>{st.detail}</span></li>
          {/each}
        </ol>
        {#if setup.ok}<p class="msg good">Xong. Broker thử trên máy này vừa khởi động lại nên board giả lập đang chạy bị ngắt: bấm Reset (⟳) trên bàn làm việc, vài giây sau board sẽ hiện ở Home Assistant → Cài đặt → Thiết bị & dịch vụ → MQTT.</p>{/if}
      {/if}
      <details>
        <summary>Tự làm bằng lệnh trên box</summary>
        <div class="codebox">
          <pre>{commands}</pre>
          <button onclick={() => copy('cmd', commands)}>{copied === 'cmd' ? 'Đã chép ✓' : 'Chép'}</button>
        </div>
      </details>
    </section>

    <form onsubmit={save}>
      <div class="two">
        <section>
          <h2>Wi-Fi</h2>
          <label>Tên mạng (SSID)<input bind:value={wifiSsid} required maxlength="32" autocomplete="off" spellcheck="false" /></label>
          <label>
            Mật khẩu
            <span class="pw">
              <input type={showWifi ? 'text' : 'password'} bind:value={wifiPassword} autocomplete="new-password" placeholder={view.wifiPassword ? 'Đã lưu: để trống để giữ nguyên' : 'Mật khẩu Wi-Fi'} />
              <button type="button" onclick={() => (showWifi = !showWifi)}>{showWifi ? 'Ẩn' : 'Hiện'}</button>
            </span>
          </label>
          <p class="hint">ESP32 chỉ bắt được Wi-Fi 2,4 GHz. Board giả lập nhận mọi tên mạng.</p>
        </section>

        <section>
          <h2>Broker MQTT (Home Assistant)</h2>
          <div class="hostport">
            <label class="grow">Địa chỉ box<input bind:value={mqttHost} required placeholder="192.168.1.10" spellcheck="false" /></label>
            <label class="port">Cổng<input type="number" min="1" max="65535" bind:value={mqttPort} required /></label>
          </div>
          <label>Tài khoản<input bind:value={mqttUser} required spellcheck="false" autocomplete="off" /></label>
          <label>
            Mật khẩu
            <span class="pw">
              <input type={showMqtt ? 'text' : 'password'} bind:value={mqttPassword} autocomplete="new-password" placeholder={view.mqttPassword ? 'Đã lưu: để trống để giữ nguyên' : 'Mật khẩu tài khoản trên box'} />
              <button type="button" onclick={() => (showMqtt = !showMqtt)}>{showMqtt ? 'Ẩn' : 'Hiện'}</button>
            </span>
          </label>
          <div class="row">
            <button type="button" onclick={runTest} disabled={testing || !mqttHost}>{testing ? 'Đang thử…' : 'Thử đăng nhập broker'}</button>
            {#if test}<span class="msg" class:good={test.ok} class:bad={!test.ok}>{#if test.ok}<Icon name="check" size={14} />{/if}{test.message}</span>{/if}
          </div>
        </section>
      </div>

      <section class="savebar">
        <button class="primary" type="submit" disabled={saving || !dirty}>{saving ? 'Đang lưu…' : 'Lưu cấu hình'}</button>
        {#if saved}<span class="msg" class:good={saved.ok} class:bad={!saved.ok}>{saved.text}</span>
        {:else if !dirty}<span class="hint">Không có thay đổi.</span>{/if}
      </section>
    </form>

    <section>
      <h2>Dùng trong một board mới</h2>
      <label class="name">Tên board <input bind:value={boardName} spellcheck="false" /> <span class="hint">mỗi board một tên: chữ, số, - và _</span></label>
      <div class="two">
        <div class="codebox">
          <pre>{code}</pre>
          <button onclick={() => copy('code', code)}>{copied === 'code' ? 'Đã chép ✓' : 'Chép main.cpp'}</button>
        </div>
        <dl>
          <dt>Trong Home Assistant</dt>
          <dd>Thiết bị <b>{id}</b>, tự hiện, không cần cài gì</dd>
          <dt>Topic</dt>
          <dd><code>home/lab/{id}/led/state</code><br /><code>home/lab/{id}/led/set</code><br /><code>home/lab/{id}/availability</code></dd>
          <dt>Trên board giả lập</dt>
          <dd>Thành <b>{id}-sim</b>, nói chuyện với broker thử trên máy này (<code>10.0.2.2</code>), không bao giờ với box</dd>
        </dl>
      </div>
    </section>
  {:else}
    <section><p class="hint">Đang đọc cấu hình…</p></section>
  {/if}
</DocSheet>

<style>
  .intro h1 { margin-bottom: 6px; }
  .intro p { margin: 0 0 12px; color: var(--ink-2); line-height: 1.6; font-size: 14px; max-width: 760px; }
  form { display: contents; }
  code { font: 12.5px var(--font-mono); background: var(--surface-2); padding: 0 4px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font: 600 11.5px var(--font-mono); padding: 2px 8px; border: 1px solid var(--line); color: var(--ink-3); }
  .chip.good { color: var(--ok); background: var(--ok-soft); border-color: var(--ok-dot); }
  .chip.bad { color: var(--warn); background: var(--warn-soft); border-color: var(--warn-dot); }
  label { display: flex; flex-direction: column; gap: 4px; font: 600 12px var(--font-mono); color: var(--ink-3); margin-bottom: 10px; }
  label input { font: 14px var(--font-ui); color: var(--ink); }
  .pw { display: flex; gap: 6px; }
  .pw input { flex: 1; min-width: 0; }
  .hostport { display: flex; gap: 8px; }
  .grow { flex: 1; }
  .port { width: 96px; }
  .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .hint { margin: 0; color: var(--ink-3); font-size: 12.5px; line-height: 1.5; font-weight: 400; font-family: var(--font-ui); }
  .msg { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; line-height: 1.5; margin: 0; }
  .msg.good { color: var(--ok); }
  .msg.bad { color: var(--error); }
  .savebar { display: flex; align-items: center; gap: 12px; position: sticky; bottom: 0; }
  .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; padding: 6px 16px; }
  .sub { font: 400 11.5px var(--font-ui); text-transform: none; letter-spacing: 0; color: var(--ink-3); }
  .codebox { position: relative; margin-top: 8px; }
  .codebox pre { margin: 0; padding: 10px 12px; background: var(--term); color: #e6e8eb; font: 12.5px/1.5 var(--font-mono); overflow: auto; white-space: pre; }
  .codebox button { position: absolute; top: 6px; right: 6px; font-size: 12px; padding: 2px 8px; }
  .name { flex-direction: row; align-items: center; gap: 8px; }
  .name input { width: 200px; }
  dl { margin: 8px 0 0; font-size: 13px; line-height: 1.6; }
  dt { font: 600 11px var(--font-mono); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); margin-top: 10px; }
  dt:first-child { margin-top: 0; }
  dd { margin: 2px 0 0; color: var(--ink-2); }
  .setup { border-left: 4px solid var(--accent); }
  .setup.done { border-left-color: var(--ok-dot); }
  .setup > .hint { margin-bottom: 10px; max-width: 820px; }
  .sshform { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; margin-top: 8px; }
  .sshform label { margin-bottom: 0; min-width: 200px; }
  .steps { margin: 12px 0 4px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .steps li { display: flex; flex-direction: column; gap: 2px; padding: 6px 10px; border-left: 3px solid; font-size: 13px; }
  .steps li.good { border-color: var(--ok-dot); background: var(--ok-soft); }
  .steps li.bad { border-color: var(--error); background: var(--error-soft); }
  .steps li.bad b { color: var(--error); }
  .steps li span { color: var(--ink-2); }
  details { margin-top: 10px; }
  summary { cursor: pointer; font-size: 12.5px; color: var(--ink-3); }
</style>
