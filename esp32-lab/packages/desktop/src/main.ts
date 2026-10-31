// ESP32 Lab as a desktop app (Electron). The window shows the same web app as the browser
// version, at app://lab, so its localStorage (benches, code, settings) stays put between
// launches. Requests to app://lab go to the local server (server.ts), which also compiles
// sketches with PlatformIO. Without a compiler yet, the window opens on the setup page, which
// installs one into the app's own folder (toolchain.ts).

import { app, BrowserWindow, net, protocol, shell } from 'electron';
import { join } from 'node:path';
import { claudeCli } from '../../lab-server/src/claude-cli';
import { labServer } from '../../lab-server/src/index';
import { startServer, TOKEN_HEADER } from './server';
import { ToolchainSetup } from './toolchain';

const ORIGIN = 'app://lab';

// ESP32LAB_DATA_DIR: keep everything (compiler, builds, the app's storage) in another folder,
// e.g. to try the first launch on a computer that already has the app
if (process.env.ESP32LAB_DATA_DIR) app.setPath('userData', process.env.ESP32LAB_DATA_DIR);

// ESP32LAB_CLAUDE_CODE=1: the AI assistant may also run through Claude Code on this computer, on
// the user's own Claude login (see lab-server/src/claude-cli.ts). Off until Anthropic's terms for
// letting another app use a Claude Code login are settled; then this can turn on for everyone.
const CLAUDE_CODE = process.env.ESP32LAB_CLAUDE_CODE === '1';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true } },
]);

/** Where the app's files are: inside the installed app, or in this repository while developing. */
function paths() {
  const setupDir = join(__dirname, 'setup');
  if (app.isPackaged) {
    const res = process.resourcesPath;
    return { setupDir, webDir: join(res, 'web'), course: join(res, 'course') };
  }
  const lab = join(__dirname, '../../..');
  return { setupDir, webDir: join(lab, 'packages/app/dist'), course: join(lab, '..') };
}

/**
 * Writable folder for the compiler and the builds. PlatformIO's toolchain breaks on paths with
 * non-ASCII characters (a Windows user name like "Hùng"), so on Windows such a path moves to
 * the root of the system drive.
 */
function dataDir(): string {
  const dir = app.getPath('userData');
  if (process.platform === 'win32' && /[^\x20-\x7e]/.test(dir)) return join(process.env.SystemDrive ?? 'C:', '\\esp32lab');
  return dir;
}

async function main() {
  if (!app.requestSingleInstanceLock()) return app.quit();
  await app.whenReady();

  const { setupDir, webDir, course } = paths();
  const base = dataDir();
  let setup: ToolchainSetup;
  const lab = labServer({
    projectRoot: course,
    pioBuildDir: join(course, '.pio', 'build'),
    workDir: join(base, 'build'),
    pio: () => setup.current?.pio ?? 'pio',
    env: () => setup.current?.env ?? process.env,
  });
  // ESP32LAB_OWN_TOOLCHAIN=1: ignore a PlatformIO already on this computer (to try the setup)
  setup = new ToolchainSetup(join(base, 'toolchain'), process.env.ESP32LAB_OWN_TOOLCHAIN === '1', lab.build);
  const ready = await setup.find();
  const claude = CLAUDE_CODE ? claudeCli({ workDir: join(base, 'claude') }) : undefined;
  const { port, token } = await startServer({ webDir, setupDir, lab, setup, claude });

  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    const headers = new Headers({ [TOKEN_HEADER]: token });
    const type = req.headers.get('content-type');
    if (type) headers.set('content-type', type);
    const r = await net.fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, {
      method: req.method,
      headers,
      body: req.body,
      duplex: 'half',
    } as RequestInit);
    // A fresh response of app://lab: the local server's own fails the page's CORS checks
    // (module scripts and the worker are loaded in cors mode)
    return new Response(r.body, { status: r.status, headers: r.headers });
  });

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'ESP32 Lab',
    backgroundColor: '#f4f3ee',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // Links out of the app open in the user's browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('window-all-closed', () => app.quit());

  await win.loadURL(ready ? `${ORIGIN}/` : `${ORIGIN}/setup.html`);
}

void main();
