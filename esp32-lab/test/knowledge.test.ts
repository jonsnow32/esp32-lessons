import { describe, expect, it } from 'vitest';
import { BOARDS, FEATURED, LESSONS, PARTS } from '../packages/app/src/lib/catalog';
import { benchKnowledge, boardPins, lessonInfo, libraryList, partCatalog, partInfo, pinText, projectCatalog, projectInfo } from '../packages/app/src/lib/knowledge';

const devkit = BOARDS['esp32-devkit-v1']!;

describe('what the AI assistant can look up', () => {
  it('lists every part type and project', () => {
    const parts = partCatalog();
    for (const type of Object.keys(PARTS)) expect(parts).toContain(`- ${type}: `);
    const projects = projectCatalog();
    for (const f of FEATURED) expect(projects).toContain(`- ${f.id}: `);
  });

  it('describes a part from its manifest and doc, with the specs for the props asked', () => {
    const red = partInfo('led')!;
    expect(red).toContain(PARTS.led!.manifest.learn!.summary);
    expect(red).toContain('anode');
    expect(red).toContain('color: một trong');
    expect(red).toContain('Số liệu:');
    expect(partInfo('led', { color: 'blue' })).not.toEqual(red);
    expect(partInfo('dht')).toContain('10000 Ω từ data lên 3v3');
    expect(partInfo('no-such-part')).toBeNull();
  });

  it('finds a pin by its label or its GPIO and says whether to use it', () => {
    const label = devkit.pins.find((p) => 'pad' in p.connect && p.connect.pad === 'GPIO12')!.name;
    for (const name of [label, 'GPIO12', '12', 'gpio12']) expect(pinText(devkit, name)).toMatch(/cẩn thận/);
    expect(pinText(devkit, 'GPIO34')).toContain('Chỉ đọc vào');
    expect(pinText(devkit, 'D99')).toBeNull();
    expect(boardPins(devkit).split('\n')).toHaveLength(devkit.pins.length + 1);
  });

  it('gives a featured project with its sketch', () => {
    const f = FEATURED[0]!;
    const text = projectInfo(f.id)!;
    expect(text).toContain(f.summary);
    expect(text).toContain(f.code);
    expect(projectInfo('nope')).toBeNull();
  });

  it('gives the lesson steps with what each checks and which passed', () => {
    const l = LESSONS[1]!;
    const text = lessonInfo(l.id, (id) => id === l.steps[0]!.id)!;
    expect(text).toContain(`[đã đạt] ${l.steps[0]!.title}`);
    expect(text).toContain(`[chưa đạt] ${l.steps[1]!.title}`);
    expect(text).toContain('kiểm tra: {"kind":"series"');
  });

  it('lists the headers the build can include', () => {
    expect(libraryList()).toContain('#include <DHT.h>');
  });

  it('adds the tips of the part types on the bench and the board pins in use', () => {
    const lines = benchKnowledge(FEATURED.find((f) => f.id === 'plant-watering')!.project, devkit, ['D34']).join('\n');
    expect(lines).toContain('- relay: ');
    expect(lines).toContain('Chân board đang dùng:');
  });
});
