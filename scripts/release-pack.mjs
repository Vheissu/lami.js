import { mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.resolve(repoRoot, process.argv[2] ?? '.release');

const packages = [
  { name: '@lami.js/runtime', dir: 'packages/runtime' },
  { name: '@lami.js/compiler', dir: 'packages/compiler' },
  { name: '@lami.js/ssr', dir: 'packages/ssr' },
  { name: '@lami.js/web-component', dir: 'packages/web-component' },
  { name: '@lami.js/vite', dir: 'packages/vite' }
];

await rm(releaseDir, { force: true, recursive: true });
await mkdir(releaseDir, { recursive: true });

const packed = [];

for (const entry of packages) {
  const cwd = path.join(repoRoot, entry.dir);
  const { stdout } = await exec('pnpm', ['pack', '--pack-destination', releaseDir], { cwd });
  const tarball = stdout.trim().split(/\r?\n/).at(-1);
  if (!tarball) throw new Error(`pnpm pack did not return a tarball for ${entry.name}`);

  packed.push({
    name: entry.name,
    directory: entry.dir,
    tarball: slash(path.relative(repoRoot, path.resolve(tarball)))
  });
}

await writeFile(
  path.join(releaseDir, 'release-tarballs.json'),
  `${JSON.stringify({ packages: packed }, null, 2)}\n`
);

for (const entry of packed) {
  console.log(`${entry.name} -> ${entry.tarball}`);
}

function slash(value) {
  return value.split(path.sep).join('/');
}
