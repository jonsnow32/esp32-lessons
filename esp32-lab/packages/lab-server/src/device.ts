// A real ESP32 on a USB port: which ports there are, and a serial line to one of them.
//
// The serial line is a small Python program on pyserial, which every PlatformIO install carries
// (its virtualenv's python, next to pio), so the lab needs no native Node module. The program
// passes the port's bytes to its stdout as they come, and takes JSON lines on its stdin:
// {"w": text} to send, {"reset": true} to pulse EN through RTS the way esptool does.
// It opens the port with DTR and RTS released, so the board's auto-reset circuit leaves the chip
// running (and out of download mode).

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export interface SerialPortInfo {
  port: string;
  description: string;
  hwid: string;
  /** USB-serial chips ESP32 boards carry (CP210x, CH340/CH9102, FTDI, Espressif's own USB). */
  likely: boolean;
}

/** USB vendor:product ids of the USB-serial chips on ESP32 boards. */
const BRIDGES = [/10C4:EA6/i, /1A86:(7523|55D[34])/i, /0403:60/i, /303A:/i];
/** Ports that are never a board (macOS Bluetooth and debug ports). */
const NEVER = /bluetooth|debug-console|wlan-debug/i;

/** The ports `pio device list` sees, likely boards first. */
export function listPorts(pio: string, env: NodeJS.ProcessEnv): Promise<SerialPortInfo[]> {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(pio, ['device', 'list', '--serial', '--json-output'], { env });
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve([]));
    child.on('close', () => {
      try {
        const list = JSON.parse(out) as { port: string; description: string; hwid: string }[];
        const ports = list
          .filter((p) => !NEVER.test(p.port))
          .map((p) => ({ ...p, likely: BRIDGES.some((re) => re.test(p.hwid)) || /usbserial|usbmodem|SLAB|wchusb|ttyUSB|ttyACM/i.test(p.port) }));
        resolve(ports.sort((a, b) => Number(b.likely) - Number(a.likely) || a.port.localeCompare(b.port)));
      } catch {
        resolve([]);
      }
    });
  });
}

const BRIDGE_PY = `# ESP32 Lab serial line
import json, os, sys, threading, time
import serial
s = serial.Serial()
s.port = sys.argv[1]
s.baudrate = int(sys.argv[2])
s.timeout = 0.02
s.dtr = False
s.rts = False
try:
    s.open()
except Exception as e:
    sys.stderr.write(str(e))
    sys.stderr.flush()
    os._exit(2)
out = sys.stdout.buffer
def pump():
    while True:
        try:
            d = s.read(4096)
        except Exception as e:
            sys.stderr.write(str(e))
            sys.stderr.flush()
            os._exit(3)
        if d:
            out.write(d)
            out.flush()
threading.Thread(target=pump, daemon=True).start()
for line in sys.stdin:
    try:
        m = json.loads(line)
    except ValueError:
        continue
    if "w" in m:
        s.write(m["w"].encode("utf-8"))
    if m.get("reset"):
        s.dtr = False
        s.rts = True
        time.sleep(0.12)
        s.rts = False
os._exit(0)
`;

/** PlatformIO's own python (it has pyserial), next to pio; else whatever python is on the PATH. */
export function pythonFor(pio: string): string {
  const win = process.platform === 'win32';
  const dir = dirname(pio);
  if (dir !== '.' && basename(dir).length) {
    const py = join(dir, win ? 'python.exe' : 'python');
    if (existsSync(py)) return py;
  }
  return win ? 'python' : 'python3';
}

/** One serial line open at a time; opening another (or uploading) closes it. */
export class SerialLine {
  private child: ChildProcess | null = null;
  port: string | null = null;

  /**
   * Open `port`: its bytes go to `data` as they come; `closed` once it ends, with the reason
   * if it failed. Any line already open is closed first.
   */
  open(python: string, port: string, baud: number, data: (bytes: Buffer) => void, closed: (error?: string) => void) {
    this.close();
    const child = spawn(python, ['-u', '-c', BRIDGE_PY, port, String(baud)], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.port = port;
    let err = '';
    child.stdout!.on('data', data);
    child.stderr!.on('data', (d) => (err += d));
    child.on('error', (e) => (err += e.message));
    child.on('close', (code) => {
      if (this.child === child) {
        this.child = null;
        this.port = null;
      }
      closed(code ? err.trim() || `serial line ended (${code})` : undefined);
    });
  }

  write(text: string) {
    this.child?.stdin?.write(JSON.stringify({ w: text }) + '\n');
  }

  /** Restart the chip: EN low for a moment through RTS. */
  reset() {
    this.child?.stdin?.write('{"reset": true}\n');
  }

  /** Close the port; resolves once it is free for someone else (esptool). */
  close(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.port = null;
    if (!child || child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      child.once('close', () => resolve());
      child.stdin?.end();
      child.kill();
      setTimeout(resolve, 1500);
    });
  }
}
