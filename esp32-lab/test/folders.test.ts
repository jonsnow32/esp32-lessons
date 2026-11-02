// Linked folders: found under the course, read and written in place, never outside it.

import { checkNewFolder, findFolders, folderPath, folderSources, isSourceName, linkFolder, readFolder, unlinkFolder, writeFolder } from '../packages/lab-server/src/folders';
import { parseErrors } from '../packages/lab-server/src/index';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function course() {
  const root = mkdtempSync(join(tmpdir(), 'lab-folders-'));
  const add = (rel: string, files: Record<string, string>) => {
    mkdirSync(join(root, rel), { recursive: true });
    for (const [n, text] of Object.entries(files)) writeFileSync(join(root, rel, n), text);
  };
  add('home-server/esp32-mqtt', { 'main.cpp': '// mqtt\n', 'secrets.h': '#define X 1\n', 'esp32-lab.json': '{"title":"MQTT"}\n', 'README.md': '' });
  add('notes/no-link', { 'main.cpp': '' });
  add('node_modules/pkg', { 'main.cpp': '', 'esp32-lab.json': '{}' });
  add('.hidden/x', { 'main.cpp': '', 'esp32-lab.json': '{}' });
  return root;
}

describe('linked folders', () => {
  it('finds the folders with esp32-lab.json and main.cpp, skipping node_modules and dot folders', () => {
    const root = course();
    expect(findFolders(root).map((f) => [f.path, f.title])).toEqual([['home-server/esp32-mqtt', 'MQTT']]);
  });

  it('only opens linked folders inside the course', () => {
    const root = course();
    expect(folderPath(root, 'home-server/esp32-mqtt')).toBe(join(root, 'home-server/esp32-mqtt'));
    expect(folderPath(root, 'notes/no-link')).toBeNull();
    expect(folderPath(root, '../etc')).toBeNull();
    expect(folderPath(root, 'home-server/../../x')).toBeNull();
    expect(folderPath(root, '.hidden/x')).toBeNull();
    expect(folderPath(root, '')).toBeNull();
  });

  it('reads and writes main.cpp and the circuit in place', () => {
    const root = course();
    const dir = folderPath(root, 'home-server/esp32-mqtt')!;
    expect(readFolder(dir)).toEqual({ title: 'MQTT', project: null, code: '// mqtt\n', files: { 'secrets.h': '#define X 1\n' } });
    writeFolder(dir, { code: '// edited\n', project: { parts: [] } });
    expect(readFileSync(join(dir, 'main.cpp'), 'utf8')).toBe('// edited\n');
    expect(readFolder(dir)).toEqual({ title: 'MQTT', project: { parts: [] }, code: '// edited\n', files: { 'secrets.h': '#define X 1\n' } });
    writeFolder(dir, { title: 'Công tắc' });
    expect(readFolder(dir).title).toBe('Công tắc');
    expect(readFolder(dir).project).toEqual({ parts: [] });
  });

  it('builds with the other sources next to main.cpp', () => {
    const root = course();
    expect(folderSources(folderPath(root, 'home-server/esp32-mqtt')!)).toEqual({ 'secrets.h': '#define X 1\n' });
  });

  it('checks a typed folder for a new project', () => {
    const root = course();
    expect(checkNewFolder(root, 'home-server/esp32-door')).toEqual({ ok: true, path: 'home-server/esp32-door', exists: false, hasCode: false });
    expect(checkNewFolder(root, `${root}/notes/no-link/`)).toEqual({ ok: true, path: 'notes/no-link', exists: true, hasCode: true });
    for (const bad of ['', '../outside', '/etc', 'home-server/esp32-mqtt', '.hidden/new', 'a/node_modules/b', 'home-server/esp32-mqtt/main.cpp/x', 'a/b/c/d/e/f/g']) {
      expect(checkNewFolder(root, bad).ok, bad).toBe(false);
    }
  });

  it('links a new folder, keeping a main.cpp already there, and unlinks it without touching the code', () => {
    const root = course();
    const made = linkFolder(root, 'projects/door', { title: 'Cửa', project: { parts: [] }, code: '// new\n' });
    expect(made).toMatchObject({ path: 'projects/door', title: 'Cửa', code: '// new\n', files: {} });
    expect(findFolders(root).map((f) => f.path)).toContain('projects/door');
    const kept = linkFolder(root, 'notes/no-link', { title: 'Có sẵn', project: null, code: '// would replace\n' });
    expect(kept).toMatchObject({ path: 'notes/no-link', code: '' });
    expect(linkFolder(root, 'projects/door', { title: 'x', project: null, code: '' })).toBe('Thư mục này đã là một dự án trong lab.');

    unlinkFolder(folderPath(root, 'projects/door')!);
    expect(findFolders(root).map((f) => f.path)).not.toContain('projects/door');
    expect(existsSync(join(root, 'projects/door/main.cpp'))).toBe(true);
  });

  it('creates, edits and deletes the other sources by name, never outside the folder', () => {
    const root = course();
    const dir = folderPath(root, 'home-server/esp32-mqtt')!;
    writeFolder(dir, { files: { 'wifi.h': '#pragma once\n', 'wifi.cpp': '// wifi\n' } });
    expect(readFolder(dir).files).toEqual({ 'secrets.h': '#define X 1\n', 'wifi.cpp': '// wifi\n', 'wifi.h': '#pragma once\n' });
    writeFolder(dir, { files: { 'wifi.cpp': null, 'wifi.h': '// v2\n' } });
    expect(readFolder(dir).files).toEqual({ 'secrets.h': '#define X 1\n', 'wifi.h': '// v2\n' });
    // Not plain source names: left alone
    writeFolder(dir, { files: { '../evil.h': 'x', 'sub/a.h': 'x', 'main.cpp': 'x', 'README.md': 'x', '.hidden.h': 'x' } });
    expect(existsSync(join(root, 'home-server/evil.h'))).toBe(false);
    expect(readFileSync(join(dir, 'main.cpp'), 'utf8')).toBe('// mqtt\n');
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('');
    expect(existsSync(join(dir, '.hidden.h'))).toBe(false);
    expect(['wifi.h', 'a_b-1.hpp', 'x.c'].every(isSourceName)).toBe(true);
    expect(['main.cpp', '../a.h', 'a/b.h', '.a.h', 'a.txt', 'a.h ', ''].some(isSourceName)).toBe(false);
  });

  it('tells which source a compiler error is in', () => {
    const log = [
      '/work/sketch/src/main.cpp:12:5: error: expected \';\' before \'}\' token',
      '.pio/libdeps/sketch/ESP32Servo/src/ESP32PWM.cpp:283:32: warning: unused variable \'val\'',
      '/work/sketch/.pio/libdeps/sketch/ESP32Servo/src/ESP32Servo.cpp:58:20: warning: \'TAG\' defined but not used',
      'src/wifi.cpp:3:1: warning: unused variable \'x\'',
      'In file included from src/main.cpp:2:',
      'src/wifi.h:7:10: fatal error: missing.h: No such file or directory',
    ].join('\n');
    expect(parseErrors(log)).toEqual([
      { file: 'main.cpp', line: 12, column: 5, severity: 'error', message: "expected ';' before '}' token" },
      { file: 'wifi.cpp', line: 3, column: 1, severity: 'warning', message: "unused variable 'x'" },
      { file: 'wifi.h', line: 7, column: 10, severity: 'error', message: 'missing.h: No such file or directory' },
    ]);
  });
});
