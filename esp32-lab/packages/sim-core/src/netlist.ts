// Netlist: which connection points are electrically the same node.
// Every hole, board pin, MCU pad and part terminal is a key; breadboard strips, plugged legs,
// wires and in-part shorts merge keys with Union-Find. Rebuilt from scratch on every edit –
// near-linear time, so it is cheap even for large circuits.

export class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  add(key: string): void {
    if (!this.parent.has(key)) {
      this.parent.set(key, key);
      this.rank.set(key, 0);
    }
  }

  find(key: string): string {
    this.add(key);
    let root = key;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression
    let cur = key;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra)!;
    const rankB = this.rank.get(rb)!;
    if (rankA < rankB) this.parent.set(ra, rb);
    else if (rankA > rankB) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  keys(): IterableIterator<string> {
    return this.parent.keys();
  }
}

export const GROUND_KEY = 'net:GND';

/** Frozen result: net index per key. Net 0 is always ground. */
export class Netlist {
  readonly netCount: number;
  private readonly netOfKey = new Map<string, number>();
  private readonly members: string[][];

  constructor(uf: UnionFind) {
    uf.add(GROUND_KEY);
    const indexOfRoot = new Map<string, number>([[uf.find(GROUND_KEY), 0]]);
    this.members = [[]];
    for (const key of uf.keys()) {
      const root = uf.find(key);
      let index = indexOfRoot.get(root);
      if (index === undefined) {
        index = this.members.length;
        indexOfRoot.set(root, index);
        this.members.push([]);
      }
      this.netOfKey.set(key, index);
      this.members[index]!.push(key);
    }
    this.netCount = this.members.length;
  }

  net(key: string): number | undefined {
    return this.netOfKey.get(key);
  }

  keysOf(net: number): readonly string[] {
    return this.members[net] ?? [];
  }

  connected(a: string, b: string): boolean {
    const na = this.net(a);
    return na !== undefined && na === this.net(b);
  }
}
