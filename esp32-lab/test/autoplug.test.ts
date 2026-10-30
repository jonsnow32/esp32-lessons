import { ESP32_PAD_NAMES } from '@esp32lab/mcu-esp32';
import { resolvePlacement, type Project } from '@esp32lab/project-model';
import { GROUND_KEY, keyOf, ScriptedMcu, SimKernel } from '@esp32lab/sim-core';
import { describe, expect, it } from 'vitest';
import { autoPlug } from '../packages/app/src/lib/autoplug';
import { BOARDS, BREADBOARDS, PARTS } from '../packages/app/src/lib/catalog';
import { breadboard } from '../packages/app/src/lib/geometry';

const kernel = (project: Project) =>
  new SimKernel({ project, board: BOARDS[project.board.type]!, breadboards: BREADBOARDS, parts: PARTS, mcu: new ScriptedMcu(ESP32_PAD_NAMES) });

const bench = (parts: Project['parts'], breadboards: Project['breadboards'] = [{ id: 'bb1', type: 'half-400', x: 15, y: 6 }]): Project => ({
  schemaVersion: 1,
  board: { type: 'esp32-devkit-v1', x: 1, y: 3 },
  breadboards,
  parts,
  wires: [],
  firmware: { kind: 'none' },
});

const plug = (project: Project, id: string) => {
  const r = autoPlug(project, id, kernel);
  if (!r.ok) throw new Error(r.reason);
  return { ...r, k: kernel(r.project) };
};

const same = (k: SimKernel, a: string, b: string) => k.netlist.connected(a, b);

describe('plugging a part in with one click', () => {
  it('puts an LED from the bench onto the breadboard, a 220 Ω resistor to a GPIO, the cathode to GND', () => {
    const { project, k, report } = plug(bench([{ id: 'led1', type: 'led', props: {}, placement: null, bench: { x: 40, y: 2, rot: 0 } }]), 'led1');
    const led = project.parts.find((p) => p.id === 'led1')!;
    expect(led.placement?.bb).toBe('bb1');
    expect(led.bench).toBeUndefined();
    const res = project.parts.find((p) => p.type === 'resistor')!;
    expect(res.props).toEqual({ resistance: 220 });
    expect(res.placement).not.toBeNull();
    expect(same(k, keyOf.terminal('led1', 'cathode'), GROUND_KEY)).toBe(true);
    // Anode → resistor → a GPIO, never straight to the pad
    const anodeSide = same(k, keyOf.terminal('led1', 'anode'), keyOf.terminal(res.id, 'a')) ? 'b' : 'a';
    const pad = ESP32_PAD_NAMES.find((p) => same(k, keyOf.terminal(res.id, anodeSide), keyOf.pad(p)));
    expect(pad).toBeDefined();
    expect(ESP32_PAD_NAMES.some((p) => same(k, keyOf.terminal('led1', 'anode'), keyOf.pad(p)))).toBe(false);
    expect(report).toHaveLength(2);
  });

  it('feeds the rails from the board once and takes power from them', () => {
    const first = plug(bench([{ id: 'pir1', type: 'pir-sensor', props: {}, placement: null, bench: { x: 40, y: 2, rot: 0 } }]), 'pir1');
    expect(same(first.k, keyOf.terminal('pir1', 'vcc'), keyOf.net('5V'))).toBe(true);
    expect(same(first.k, keyOf.terminal('pir1', 'gnd'), GROUND_KEY)).toBe(true);
    const railWires = first.project.wires.filter((w) => [w.a, w.b].some((e) => e.kind === 'hole' && /^(tp|tn|bp|bn)/.test(e.hole)));
    expect(railWires.length).toBeGreaterThan(0);

    // A second part needing GND uses the rail already fed rather than another board pin
    const two = structuredClone(first.project);
    two.parts.push({ id: 'pushbutton1', type: 'pushbutton', props: {}, placement: null, bench: { x: 40, y: 2, rot: 0 } });
    const second = plug(two, 'pushbutton1');
    const toGndPin = (p: Project) => p.wires.filter((w) => [w.a, w.b].some((e) => e.kind === 'board' && e.pin.startsWith('GND'))).length;
    expect(toGndPin(second.project)).toBe(toGndPin(first.project));
    expect(same(second.k, keyOf.terminal('pushbutton1', 'b1'), GROUND_KEY)).toBe(true);
  });

  it('makes a button straddle the gap, its two sides in separate strips', () => {
    const { project, k } = plug(bench([{ id: 'b1', type: 'pushbutton', props: {}, placement: null, bench: { x: 40, y: 2, rot: 0 } }]), 'b1');
    const p = project.parts[0]!;
    const r = resolvePlacement(breadboard('half-400')!, PARTS.pushbutton!.manifest, p.placement!.hole, p.placement!.rot);
    expect(r.ok && new Set(Object.values(r.holes).map((h) => h.replace(/\D/g, ''))).size).toBeGreaterThanOrEqual(2);
    expect(same(k, keyOf.terminal('b1', 'a1'), keyOf.terminal('b1', 'b1'))).toBe(false);
    expect(ESP32_PAD_NAMES.some((pad) => same(k, keyOf.terminal('b1', 'a1'), keyOf.pad(pad)))).toBe(true);
  });

  it('gives each part its own GPIO, analog reads on ADC1, I2C on GPIO21/22', () => {
    let project = bench([
      { id: 'pot1', type: 'potentiometer', props: {}, placement: null, bench: { x: 40, y: 2, rot: 0 } },
      { id: 'pot2', type: 'potentiometer', props: {}, placement: null, bench: { x: 44, y: 2, rot: 0 } },
      { id: 'oled1', type: 'ssd1306', props: {}, placement: null, bench: { x: 48, y: 2, rot: 0 } },
    ]);
    for (const id of ['pot1', 'pot2', 'oled1']) project = plug(project, id).project;
    const k = kernel(project);
    const padOf = (key: string) => ESP32_PAD_NAMES.find((p) => same(k, key, keyOf.pad(p)));
    const a = padOf(keyOf.terminal('pot1', 'wiper'));
    const b = padOf(keyOf.terminal('pot2', 'wiper'));
    expect(a).not.toBe(b);
    for (const pad of [a, b]) expect(['GPIO32', 'GPIO33', 'GPIO34', 'GPIO35', 'GPIO36', 'GPIO39']).toContain(pad);
    expect(padOf(keyOf.terminal('oled1', 'sda'))).toBe('GPIO21');
    expect(padOf(keyOf.terminal('oled1', 'scl'))).toBe('GPIO22');
  });

  it('adds a pull-up to the DHT data line and follows the common prop of an RGB LED', () => {
    const dht = plug(bench([{ id: 'dht1', type: 'dht', props: {}, placement: null, bench: { x: 40, y: 2, rot: 0 } }]), 'dht1');
    const pullup = dht.project.parts.find((p) => p.type === 'resistor')!;
    expect(pullup.props).toEqual({ resistance: 10000 });
    const ends = ['a', 'b'].map((t) => keyOf.terminal(pullup.id, t));
    expect(ends.some((e) => same(dht.k, e, keyOf.terminal('dht1', 'data')))).toBe(true);
    expect(ends.some((e) => same(dht.k, e, keyOf.net('3V3')))).toBe(true);

    const rgb = plug(bench([{ id: 'rgb1', type: 'rgb-led', props: { common: 'anode' }, placement: null, bench: { x: 40, y: 2, rot: 0 } }]), 'rgb1');
    expect(same(rgb.k, keyOf.terminal('rgb1', 'common'), keyOf.net('3V3'))).toBe(true);
    expect(rgb.project.parts.filter((p) => p.type === 'resistor')).toHaveLength(3);
  });

  it('wires straight to the board when there is no breadboard', () => {
    const { project, k } = plug(bench([{ id: 'servo1', type: 'servo', props: {}, placement: null, bench: { x: 20, y: 4, rot: 0 } }], []), 'servo1');
    expect(project.parts[0]!.bench).toBeDefined();
    expect(same(k, keyOf.terminal('servo1', 'vcc'), keyOf.net('5V'))).toBe(true);
    expect(same(k, keyOf.terminal('servo1', 'gnd'), GROUND_KEY)).toBe(true);
    expect(ESP32_PAD_NAMES.some((pad) => same(k, keyOf.terminal('servo1', 'sig'), keyOf.pad(pad)))).toBe(true);
  });

  it('wires a part already on the breadboard where it is, and leaves legs already wired', () => {
    const project = bench([{ id: 'led1', type: 'led', props: {}, placement: { bb: 'bb1', hole: 'e10', rot: 0 } }]);
    project.wires.push({ id: 'w1', a: { kind: 'hole', bb: 'bb1', hole: 'a11' }, b: { kind: 'board', pin: 'GND.R' } });
    const { project: out, k, report } = plug(project, 'led1');
    expect(out.parts[0]!.placement).toEqual({ bb: 'bb1', hole: 'e10', rot: 0 });
    expect(report).toHaveLength(1);
    expect(out.wires.filter((w) => [w.a, w.b].some((e) => e.kind === 'board' && e.pin.startsWith('GND')))).toHaveLength(1);
    expect(same(k, keyOf.terminal('led1', 'cathode'), GROUND_KEY)).toBe(true);
    expect(autoPlug(out, 'led1', kernel).ok).toBe(false);
  });

  it('fits a 10-segment bar, resistors that find no strip going on the bench', () => {
    const { project, k } = plug(bench([{ id: 'bar1', type: 'led-bar', props: {}, placement: null, bench: { x: 40, y: 2, rot: 0 } }]), 'bar1');
    expect(project.parts.filter((p) => p.type === 'resistor')).toHaveLength(10);
    const pads = new Set(Array.from({ length: 10 }, (_, i) => {
      const res = project.parts.find((p) => p.type === 'resistor' && [0, 1].some((j) => same(k, keyOf.terminal(p.id, 'ab'[j]!), keyOf.terminal('bar1', `a${i}`))))!;
      return ESP32_PAD_NAMES.find((pad) => ['a', 'b'].some((t) => same(k, keyOf.terminal(res.id, t), keyOf.pad(pad))));
    }));
    expect(pads.size).toBe(10);
    expect(pads.has(undefined)).toBe(false);
  });

  it('plugs every part that says how, each leg where its spec puts it', () => {
    for (const [type, mod] of Object.entries(PARTS)) {
      const spec = mod.manifest.plug;
      if (!spec) continue;
      const { k } = plug(bench([{ id: 'x', type, props: {}, placement: null, bench: { x: 40, y: 2, rot: 0 } }]), 'x');
      for (const [t, role] of Object.entries(spec.pins)) {
        const key = keyOf.terminal('x', t);
        const net = { gnd: GROUND_KEY, '3v3': keyOf.net('3V3'), '5v': keyOf.net('5V') }[role as string];
        const direct = net ? same(k, key, net) : ESP32_PAD_NAMES.some((pad) => same(k, key, keyOf.pad(pad)));
        // Behind a series resistor the leg is not on the pad's net itself
        expect(direct || Boolean(spec.series?.[t]) || role === 'common', `${type}.${t}`).toBe(true);
      }
    }
  });

  it('takes the I2C pins and the pins to leave alone from the board', () => {
    const custom = structuredClone(BOARDS['esp32-devkit-v1']!);
    custom.id = 'test-board';
    custom.wiring = { i2c: { sda: 'GPIO25', scl: 'GPIO26' }, avoid: ['GPIO32', 'GPIO33', 'GPIO34', 'GPIO35', 'GPIO36'] };
    BOARDS['test-board'] = custom;
    try {
      const project = bench([
        { id: 'oled1', type: 'ssd1306', props: {}, placement: null, bench: { x: 40, y: 2, rot: 0 } },
        { id: 'pot1', type: 'potentiometer', props: {}, placement: null, bench: { x: 44, y: 2, rot: 0 } },
      ]);
      project.board.type = 'test-board';
      const after = plug(plug(project, 'oled1').project, 'pot1');
      const padOf = (key: string) => ESP32_PAD_NAMES.find((p) => same(after.k, key, keyOf.pad(p)));
      expect(padOf(keyOf.terminal('oled1', 'sda'))).toBe('GPIO25');
      expect(padOf(keyOf.terminal('oled1', 'scl'))).toBe('GPIO26');
      // The one ADC1 pin left
      expect(padOf(keyOf.terminal('pot1', 'wiper'))).toBe('GPIO39');

      delete custom.wiring;
      // A board that does not say where I2C goes gets no guess
      const bare = bench([{ id: 'oled1', type: 'ssd1306', props: {}, placement: null, bench: { x: 40, y: 2, rot: 0 } }]);
      bare.board.type = 'test-board';
      const none = autoPlug(bare, 'oled1', kernel);
      expect(none.ok).toBe(false);
      expect(!none.ok && none.reason).toContain('I2C');
    } finally {
      delete BOARDS['test-board'];
    }
  });
});
