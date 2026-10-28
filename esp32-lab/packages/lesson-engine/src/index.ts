// Lesson engine: evaluates the declarative checks in lesson.json against a running kernel.
// Static checks walk the netlist (is the LED really between GPIO18 and GND?); dynamic checks
// look at what the simulation produced (serial output, part observables).

import type { Project } from '@esp32lab/project-model';
import { GROUND_KEY, keyOf, type SimKernel } from '@esp32lab/sim-core';

export type NodeRef =
  | { pad: string }
  | { net: string }
  | { boardPin: string }
  | { part: string; terminal: string };

export interface PartStep {
  /** Part type, e.g. "resistor". */
  type: string;
  /** Terminal the path must enter / leave by (polarity of an LED). Omit for either way round. */
  enter?: string;
  exit?: string;
}

export type Check =
  | { kind: 'connected'; a: NodeRef; b: NodeRef }
  | { kind: 'series'; from: NodeRef; through: PartStep[]; to: NodeRef; order?: 'fixed' | 'any' }
  | { kind: 'noShort'; nets: string[] }
  | { kind: 'avoidPads'; pads: string[]; reason: string }
  | { kind: 'notDamaged' }
  | { kind: 'observable'; part: string; key: string; op: '>' | '<' | '=='; value: number | string | boolean }
  | { kind: 'serialMatches'; pattern: string };

export interface LessonStep {
  id: string;
  title: string;
  checks: Check[];
  hint?: string;
}

export interface Lesson {
  id: string;
  title: string;
  /** Lesson text in the PlatformIO course, relative to the repository root. */
  source: string;
  firmware: Project['firmware'];
  template: Project;
  steps: LessonStep[];
  /** An exercise may bring its own starting circuit (and firmware env). */
  exercises?: (LessonStep & { firmware?: Project['firmware']; template?: Project })[];
}

export interface CheckContext {
  kernel: SimKernel;
  /** Everything the firmware has printed on UART0 so far. */
  serial: string;
}

export interface CheckResult {
  check: Check;
  pass: boolean;
  detail?: string;
}

export function refKey(ref: NodeRef): string {
  if ('pad' in ref) return keyOf.pad(ref.pad);
  if ('net' in ref) return ref.net === 'GND' ? GROUND_KEY : keyOf.net(ref.net);
  if ('boardPin' in ref) return keyOf.boardPin(ref.boardPin);
  return keyOf.terminal(ref.part, ref.terminal);
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

/**
 * Is there a chain from → part → part → … → to, each hop going in one terminal and out another,
 * each part used once? Depth-first over the parts that touch the current net.
 */
function findSeries(kernel: SimKernel, fromKey: string, steps: PartStep[], toKey: string): string[] | null {
  const net = (key: string) => kernel.netlist.net(key);
  const parts = [...kernel.terminals()];

  const walk = (currentNet: number | undefined, i: number, used: Set<string>): string[] | null => {
    if (currentNet === undefined) return null;
    if (i === steps.length) return currentNet === net(toKey) ? [] : null;
    const step = steps[i]!;
    for (const [id, { type, keys }] of parts) {
      if (type !== step.type || used.has(id)) continue;
      for (const [enter, enterKey] of Object.entries(keys)) {
        if ((step.enter && enter !== step.enter) || net(enterKey) !== currentNet) continue;
        for (const [exit, exitKey] of Object.entries(keys)) {
          if (exit === enter || (step.exit && exit !== step.exit) || net(exitKey) === currentNet) continue;
          const rest = walk(net(exitKey), i + 1, new Set([...used, id]));
          if (rest) return [id, ...rest];
        }
      }
    }
    return null;
  };

  return walk(net(fromKey), 0, new Set());
}

function compare(actual: unknown, op: '>' | '<' | '==', value: unknown): boolean {
  if (op === '==') return actual === value;
  if (typeof actual !== 'number' || typeof value !== 'number') return false;
  return op === '>' ? actual > value : actual < value;
}

export function evaluate(check: Check, ctx: CheckContext): CheckResult {
  const { kernel } = ctx;
  switch (check.kind) {
    case 'connected': {
      const pass = kernel.netlist.connected(refKey(check.a), refKey(check.b));
      return { check, pass };
    }
    case 'series': {
      const orders = check.order === 'any' ? permutations(check.through) : [check.through];
      for (const order of orders) {
        const path = findSeries(kernel, refKey(check.from), order, refKey(check.to));
        if (path) return { check, pass: true, detail: path.join(' → ') };
      }
      return { check, pass: false };
    }
    case 'noShort': {
      const shorted = check.nets.filter((n) => kernel.netlist.connected(keyOf.net(n), GROUND_KEY));
      return { check, pass: shorted.length === 0, detail: shorted.length ? `${shorted.join(', ')} shorted to GND` : undefined };
    }
    case 'avoidPads': {
      // Any user part or wire touching one of these pads?
      const touched = check.pads.filter((pad) => {
        const net = kernel.netlist.net(keyOf.pad(pad));
        if (net === undefined) return false;
        return kernel.netlist.keysOf(net).some((k) => (k.startsWith('p:') && !k.startsWith('p:board.')) || k.startsWith('h:'));
      });
      return { check, pass: touched.length === 0, detail: touched.length ? `${touched.join(', ')}: ${check.reason}` : undefined };
    }
    case 'notDamaged': {
      const damaged = kernel.diagnostics.filter((d) => d.code === 'damaged').map((d) => d.part);
      return { check, pass: damaged.length === 0, detail: damaged.length ? `Destroyed: ${damaged.join(', ')}` : undefined };
    }
    case 'observable': {
      const actual = kernel.observables(check.part)[check.key];
      return { check, pass: compare(actual, check.op, check.value), detail: `${check.part}.${check.key} = ${String(actual)}` };
    }
    case 'serialMatches':
      return { check, pass: new RegExp(check.pattern, 'm').test(ctx.serial) };
  }
}

export function evaluateStep(step: LessonStep, ctx: CheckContext): { step: LessonStep; pass: boolean; results: CheckResult[] } {
  const results = step.checks.map((c) => evaluate(c, ctx));
  return { step, pass: results.every((r) => r.pass), results };
}
