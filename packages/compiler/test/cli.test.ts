import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli';

const tempDirs: string[] = [];

describe('compiler cli', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  it('compiles a single template file to the selected output mode', async () => {
    const dir = await tempDir();
    const input = path.join(dir, 'contact.html');
    const outDir = path.join(dir, 'compiled');
    await writeFile(input, '<form submit.trigger="save($event)"><input value.bind="email"><p>${email}</p></form>');

    const result = await runCli(['compile', input, '--mode', 'dom', '--outDir', outDir]);
    const output = path.join(outDir, 'contact.dom.js');
    const code = await readFile(output, 'utf8');

    expect(result.files).toEqual([output]);
    expect(result.warnings).toEqual([]);
    expect(code).toContain('export function mount');
    expect(code).toContain('bindEventCompiled');
    expect(code).toContain('bindPropertyCompiled');
  });

  it('recursively compiles html files inside a directory', async () => {
    const dir = await tempDir();
    const inputDir = path.join(dir, 'templates');
    const outDir = path.join(dir, 'ssr');
    await mkdir(inputDir, { recursive: true });
    await writeFile(path.join(inputDir, 'one.html'), '<p>${one}</p>');
    await writeFile(path.join(inputDir, 'two.html'), '<p>${two}</p>');

    const result = await runCli(['compile', inputDir, '--mode', 'ssr', '--outDir', outDir]);

    expect(result.files).toEqual([
      path.join(outDir, 'one.ssr.js'),
      path.join(outDir, 'two.ssr.js')
    ]);
    await expect(readFile(path.join(outDir, 'one.ssr.js'), 'utf8')).resolves.toContain('export async function render');
    await expect(readFile(path.join(outDir, 'two.ssr.js'), 'utf8')).resolves.toContain('export async function render');
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lami-compiler-'));
  tempDirs.push(dir);
  return dir;
}
