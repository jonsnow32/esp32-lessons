// Where the current goes, for visualisation and explanations.
//
// The solver only knows node voltages. Two steps recover currents:
// 1. Terminal currents: each part is re-stamped into a recording context at the solved
//    voltages; the current into a terminal is Σ g·(v_t − v_other) + current sources. This is
//    generic for every part that stamps conductances and current sources (all current parts,
//    pads and supplies). Ideal voltage sources would need their branch currents from the
//    solver and are not covered.
// 2. Edge currents: inside one net, current moves along the physical connections (wires,
//    breadboard strip segments, legs in holes, header pins). On a spanning tree of those
//    connections, Kirchhoff's current law fixes every edge's current. Parallel wires form
//    cycles; the tree then routes all current through one of them, which is fine for
//    drawing.

import type { NonlinearContext, PartBehavior } from '@esp32lab/part-sdk';

export type EdgeKind = 'wire' | 'strip' | 'leg' | 'pin' | 'onboard' | 'internal';

/** A physical connection between two netlist keys. */
export interface Edge {
  kind: EdgeKind;
  a: string;
  b: string;
  /** Wire id, or part id for legs / internal shorts. */
  id?: string;
}

/** An edge with the current it carries: positive means from `a` to `b`. */
export interface FlowEdge extends Edge {
  amps: number;
}

/** Current into each terminal of one part at the given voltages (A, positive = into the part). */
export function terminalCurrents(behavior: PartBehavior, v: (terminal: string) => number, terminals: string[]): Record<string, number> {
  const into: Record<string, number> = Object.fromEntries(terminals.map((t) => [t, 0]));
  const add = (t: string, i: number) => {
    if (t in into) into[t]! += i;
  };
  const ctx: NonlinearContext = {
    conductance(a, b, g) {
      const i = g * (v(a) - v(b));
      add(a, i);
      add(b, -i);
    },
    current(a, b, i) {
      add(a, i);
      add(b, -i);
    },
    voltageSource() {
      /* not supported: see header */
    },
    v,
    limited() {},
  };
  behavior.stamp?.(ctx);
  behavior.stampNonlinear?.(ctx);
  return into;
}

/**
 * Distribute currents over the connection graph. `injected` is the current each key receives
 * from parts (A, positive = flowing out of a part into the node at that key).
 */
export function edgeCurrents(edges: Edge[], injected: ReadonlyMap<string, number>): FlowEdge[] {
  const adjacency = new Map<string, number[]>();
  edges.forEach((e, k) => {
    for (const key of [e.a, e.b]) {
      if (!adjacency.has(key)) adjacency.set(key, []);
      adjacency.get(key)!.push(k);
    }
  });

  const amps = new Float64Array(edges.length);
  const visited = new Set<string>();
  for (const root of adjacency.keys()) {
    if (visited.has(root)) continue;
    // BFS spanning tree of this connected component
    const order: string[] = [root];
    const parentEdge = new Map<string, number>();
    visited.add(root);
    for (let q = 0; q < order.length; q++) {
      const node = order[q]!;
      for (const k of adjacency.get(node)!) {
        const e = edges[k]!;
        const other = e.a === node ? e.b : e.a;
        if (visited.has(other)) continue;
        visited.add(other);
        parentEdge.set(other, k);
        order.push(other);
      }
    }
    // Leaves first: whatever a subtree injects must leave through its parent edge
    const surplus = new Map<string, number>(order.map((n) => [n, injected.get(n) ?? 0]));
    for (let q = order.length - 1; q > 0; q--) {
      const node = order[q]!;
      const k = parentEdge.get(node)!;
      const e = edges[k]!;
      const s = surplus.get(node)!;
      const parent = e.a === node ? e.b : e.a;
      amps[k] = e.a === node ? s : -s; // s flows node → parent
      surplus.set(parent, surplus.get(parent)! + s);
    }
  }
  return edges.map((e, k) => ({ ...e, amps: amps[k]! }));
}
