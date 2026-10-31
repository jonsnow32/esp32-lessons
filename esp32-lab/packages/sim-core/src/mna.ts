// Modified Nodal Analysis: the method SPICE uses. Unknowns are the node voltages plus one current
// per ideal voltage source. Nonlinear parts (diodes, LEDs, transistors) are linearised around the
// previous guess and the system is re-solved until it stops moving (Newton-Raphson).

import type { NonlinearContext } from '@esp32lab/part-sdk';

/** Tiny conductance from every node to ground so floating nodes don't make the matrix singular. */
const G_MIN = 1e-12;
/** A node with less total conductance than this (apart from G_MIN) counts as floating. */
const FLOAT_THRESHOLD = 1e-9;
const MAX_ITERATIONS = 200;
const V_TOL = 1e-6;

export interface Stamper {
  /** Called once per Newton iteration with terminal-addressed contexts bound to this element. */
  stampInto(sys: MnaSystem, voltages: Float64Array): void;
}

/** Terminal-name addressing for one part; maps names to net indices (0 = ground). */
export function bindContext(sys: MnaSystem, nets: Record<string, number>, voltages: Float64Array): NonlinearContext {
  const n = (t: string) => {
    const net = nets[t];
    if (net === undefined) throw new Error(`Unknown terminal "${t}"`);
    return net;
  };
  return {
    conductance: (a, b, g) => sys.conductance(n(a), n(b), g),
    current: (a, b, i) => sys.current(n(a), n(b), i),
    transconductance: (a, b, cp, cn, gm) => sys.transconductance(n(a), n(b), n(cp), n(cn), gm),
    voltageSource: (p, m, v) => sys.voltageSource(n(p), n(m), v),
    v: (t) => voltages[n(t)] ?? 0,
    limited: () => {
      sys.limited = true;
    },
  };
}

export class MnaSystem {
  private g: { a: number; b: number; g: number }[] = [];
  private i: { a: number; b: number; i: number }[] = [];
  private gm: { a: number; b: number; cp: number; cn: number; gm: number }[] = [];
  private vs: { p: number; m: number; v: number }[] = [];
  /** Set by a part that limited its Newton step this iteration. */
  limited = false;

  constructor(readonly netCount: number) {}

  reset(): void {
    this.g.length = 0;
    this.i.length = 0;
    this.gm.length = 0;
    this.vs.length = 0;
    this.limited = false;
  }

  conductance(a: number, b: number, g: number): void {
    if (a !== b) this.g.push({ a, b, g });
  }

  current(a: number, b: number, i: number): void {
    if (a !== b) this.i.push({ a, b, i });
  }

  transconductance(a: number, b: number, cp: number, cn: number, gm: number): void {
    if (a !== b && cp !== cn) this.gm.push({ a, b, cp, cn, gm });
  }

  voltageSource(p: number, m: number, v: number): void {
    this.vs.push({ p, m, v });
  }

  /** Assemble and solve. Returns node voltages (index 0 = ground = 0 V) and floating flags. */
  solveLinear(): { v: Float64Array; floating: boolean[] } {
    const nodes = this.netCount - 1; // ground eliminated
    const size = nodes + this.vs.length;
    const A = new Float64Array(size * size);
    const z = new Float64Array(size);
    const strength = new Float64Array(this.netCount);
    const at = (r: number, c: number) => r * size + c;

    for (let k = 0; k < nodes; k++) A[at(k, k)] = A[at(k, k)]! + G_MIN;
    for (const { a, b, g } of this.g) {
      strength[a] = strength[a]! + g;
      strength[b] = strength[b]! + g;
      if (a) A[at(a - 1, a - 1)] = A[at(a - 1, a - 1)]! + g;
      if (b) A[at(b - 1, b - 1)] = A[at(b - 1, b - 1)]! + g;
      if (a && b) {
        A[at(a - 1, b - 1)] = A[at(a - 1, b - 1)]! - g;
        A[at(b - 1, a - 1)] = A[at(b - 1, a - 1)]! - g;
      }
    }
    // Not counted in `strength`: a controlled source does not tie its nodes to anything
    for (const { a, b, cp, cn, gm } of this.gm) {
      for (const [row, sign] of [[a, 1], [b, -1]] as const) {
        if (!row) continue;
        if (cp) A[at(row - 1, cp - 1)] = A[at(row - 1, cp - 1)]! + sign * gm;
        if (cn) A[at(row - 1, cn - 1)] = A[at(row - 1, cn - 1)]! - sign * gm;
      }
    }
    for (const { a, b, i } of this.i) {
      if (a) z[a - 1] = z[a - 1]! - i;
      if (b) z[b - 1] = z[b - 1]! + i;
    }
    this.vs.forEach(({ p, m, v }, k) => {
      const row = nodes + k;
      strength[p] = Infinity;
      strength[m] = Infinity;
      if (p) {
        A[at(row, p - 1)] = A[at(row, p - 1)]! + 1;
        A[at(p - 1, row)] = A[at(p - 1, row)]! + 1;
      }
      if (m) {
        A[at(row, m - 1)] = A[at(row, m - 1)]! - 1;
        A[at(m - 1, row)] = A[at(m - 1, row)]! - 1;
      }
      z[row] = v;
    });

    const x = gaussianSolve(A, z, size);
    const v = new Float64Array(this.netCount);
    v.set(x.subarray(0, nodes), 1);
    const floating = Array.from(strength, (s, net) => net !== 0 && s < FLOAT_THRESHOLD);
    return { v, floating };
  }
}

/** Solve with Newton-Raphson, re-stamping every element each iteration. */
export function solve(
  netCount: number,
  elements: Stamper[],
  initial?: Float64Array,
): { v: Float64Array; floating: boolean[]; iterations: number; converged: boolean } {
  const sys = new MnaSystem(netCount);
  let v = initial && initial.length === netCount ? initial : new Float64Array(netCount);
  let floating: boolean[] = [];
  for (let it = 1; it <= MAX_ITERATIONS; it++) {
    sys.reset();
    for (const e of elements) e.stampInto(sys, v);
    const result = sys.solveLinear();
    floating = result.floating;
    let delta = 0;
    for (let k = 0; k < netCount; k++) delta = Math.max(delta, Math.abs(result.v[k]! - v[k]!));
    v = result.v;
    if (delta < V_TOL && !sys.limited) return { v, floating, iterations: it, converged: true };
  }
  return { v, floating, iterations: MAX_ITERATIONS, converged: false };
}

/** Dense Gaussian elimination with partial pivoting. Circuits here have tens of nodes. */
function gaussianSolve(A: Float64Array, b: Float64Array, n: number): Float64Array {
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r * n + col]!) > Math.abs(A[pivot * n + col]!)) pivot = r;
    }
    if (Math.abs(A[pivot * n + col]!) < 1e-30) throw new Error('Singular circuit matrix (short across an ideal source?)');
    if (pivot !== col) {
      for (let c = 0; c < n; c++) {
        const tmp = A[col * n + c]!;
        A[col * n + c] = A[pivot * n + c]!;
        A[pivot * n + c] = tmp;
      }
      const tmp = b[col]!;
      b[col] = b[pivot]!;
      b[pivot] = tmp;
    }
    for (let r = col + 1; r < n; r++) {
      const f = A[r * n + col]! / A[col * n + col]!;
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r * n + c] = A[r * n + c]! - f * A[col * n + c]!;
      b[r] = b[r]! - f * b[col]!;
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r]!;
    for (let c = r + 1; c < n; c++) sum -= A[r * n + c]! * x[c]!;
    x[r] = sum / A[r * n + r]!;
  }
  return x;
}
