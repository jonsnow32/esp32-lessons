import type { BoardDef, BreadboardDef } from '@esp32lab/project-model';
import type { PartProps, PropSchema } from '@esp32lab/part-sdk';
import { describe, expect, it } from 'vitest';
import { PARTS } from './helpers';

/** A few values of each prop: every option, or both ends and the default of a range. */
function samples(schema: PropSchema): (number | string | boolean)[] {
  if (schema.type === 'boolean') return [false, true];
  if (schema.type === 'enum' || schema.options) return schema.options as (number | string)[];
  return [schema.min ?? 0, schema.default, schema.max ?? 100];
}

describe('part detail pages', () => {
  for (const [type, m] of Object.entries(PARTS)) {
    it(`${type} has specs and figures for every prop value`, () => {
      expect(m.doc, `${type} has no doc`).toBeDefined();
      const base: PartProps = Object.fromEntries(Object.entries(m.manifest.props).map(([k, s]) => [k, s.default]));
      const variants = [base, ...Object.entries(m.manifest.props).flatMap(([k, s]) => samples(s).map((v) => ({ ...base, [k]: v })))];
      for (const props of variants) {
        expect(m.doc!.specs(props as never).length).toBeGreaterThan(0);
        const figures = m.doc!.figures(props as never);
        expect(figures.length).toBeGreaterThan(0);
        for (const f of figures) {
          // Every number that ends up in an SVG attribute or a curve must be finite
          const text = JSON.stringify(f);
          expect(text, `${type} ${f.title}`).not.toMatch(/NaN|Infinity|undefined/);
          if (f.kind === 'chart') for (const s of f.series) for (const [x, y] of s.points) expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        }
      }
    });
  }
});

describe('board and breadboard detail pages', async () => {
  const { pinInfo } = await import('../packages/app/src/lib/pinout');
  const boards = import.meta.glob<BoardDef>('../boards/*/board.json', { eager: true, import: 'default' });
  const breadboards = import.meta.glob<BreadboardDef>('../breadboards/*/breadboard.json', { eager: true, import: 'default' });

  for (const [path, board] of Object.entries(boards)) {
    it(`${board.id} explains every pin`, () => {
      expect(board.learn?.summary, path).toBeTruthy();
      for (const p of board.pins) {
        const info = pinInfo(board, p);
        expect(info.tags.length, p.name).toBeGreaterThan(0);
        expect(info.note, p.name).not.toBe('');
        // The pins wired to the flash and USB serial must never be recommended
        if (info.gpio !== undefined && (info.gpio >= 6 && info.gpio <= 11 || info.gpio === 1 || info.gpio === 3)) expect(info.verdict, p.name).toBe('avoid');
      }
    });
  }
  for (const [path, bb] of Object.entries(breadboards)) {
    it(`${bb.id} has an introduction`, () => expect(bb.learn?.summary, path).toBeTruthy());
  }
});
