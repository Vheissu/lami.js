import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packages = [
  { name: '@lami.js/runtime', dir: 'packages/runtime' },
  { name: '@lami.js/compiler', dir: 'packages/compiler', bin: ['lami', 'lami.js'] },
  { name: '@lami.js/ssr', dir: 'packages/ssr' },
  { name: '@lami.js/vite', dir: 'packages/vite' },
  { name: '@lami.js/web-component', dir: 'packages/web-component' }
];

const workspace = await mkdtemp(path.join(tmpdir(), 'lami-pack-smoke-'));

try {
  const packed = await packPackages(workspace);
  await verifyTarballManifests(packed);
  await runConsumerSmoke(workspace, packed);
  console.log(`Package smoke passed for ${packed.length} packages.`);
} finally {
  if (process.env.LAMI_KEEP_PACK_SMOKE !== '1') {
    await rm(workspace, { force: true, recursive: true });
  } else {
    console.log(`Kept package smoke workspace: ${workspace}`);
  }
}

async function packPackages(destination) {
  const packed = [];

  for (const entry of packages) {
    const cwd = path.join(repoRoot, entry.dir);
    const { stdout } = await exec('pnpm', ['pack', '--pack-destination', destination], { cwd });
    const tarball = stdout.trim().split(/\r?\n/).at(-1);
    if (!tarball) throw new Error(`pnpm pack did not return a tarball for ${entry.name}`);
    packed.push({ ...entry, tarball });
  }

  return packed;
}

async function verifyTarballManifests(packed) {
  for (const entry of packed) {
    const manifest = JSON.parse(await tarRead(entry.tarball, 'package/package.json'));
    if (manifest.name !== entry.name) {
      throw new Error(`Expected ${entry.name}, got ${manifest.name}`);
    }
    if (manifest.license !== 'MIT') {
      throw new Error(`${entry.name} is missing MIT license metadata`);
    }
    if (!Array.isArray(manifest.files) || !manifest.files.includes('dist')) {
      throw new Error(`${entry.name} must publish an explicit dist files allowlist`);
    }
    if (JSON.stringify(manifest).includes('workspace:')) {
      throw new Error(`${entry.name} tarball still contains a workspace: dependency`);
    }

    const files = (await tarList(entry.tarball)).filter(file => file.startsWith('package/'));
    assertPackedFiles(entry.name, files);
    assertExportTargets(entry.name, manifest, files);
    assertBins(entry, manifest, files);
  }
}

function assertPackedFiles(name, files) {
  const forbidden = files.find(file =>
    file.includes('/test/') ||
    file.endsWith('/tsconfig.json') ||
    file.endsWith('/vitest.config.ts') ||
    file.endsWith('/playwright.config.ts')
  );
  if (forbidden) throw new Error(`${name} packed forbidden file ${forbidden}`);

  const unexpected = files.find(file => {
    const relative = file.slice('package/'.length);
    return relative !== 'package.json' &&
      relative !== 'README.md' &&
      relative !== 'LICENSE' &&
      !relative.startsWith('dist/') &&
      !relative.startsWith('src/');
  });
  if (unexpected) throw new Error(`${name} packed unexpected file ${unexpected}`);
}

function assertExportTargets(name, manifest, files) {
  const exports = manifest.exports ?? {};
  for (const [key, value] of Object.entries(exports)) {
    const targets = typeof value === 'string'
      ? [value]
      : Object.values(value).filter(item => typeof item === 'string');
    for (const target of targets) {
      const file = `package/${target.replace(/^\.\//, '')}`;
      if (!files.includes(file)) {
        throw new Error(`${name} export ${key} points at missing ${target}`);
      }
    }
  }
}

function assertBins(entry, manifest, files) {
  for (const name of entry.bin ?? []) {
    const target = manifest.bin?.[name];
    if (!target) throw new Error(`${entry.name} is missing bin ${name}`);
    const file = `package/${target.replace(/^\.\//, '')}`;
    if (!files.includes(file)) throw new Error(`${entry.name} bin ${name} points at missing ${target}`);
  }
}

async function runConsumerSmoke(workspace, packed) {
  const consumer = path.join(workspace, 'consumer');
  const dependencies = consumerDependencies(consumer, packed);
  await writeFile(path.join(workspace, 'package.json'), '{}');
  await mkdir(consumer, { recursive: true });
  await writeFile(
    path.join(consumer, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies,
      devDependencies: {
        '@types/node': '^22.15.3'
      },
      pnpm: {
        overrides: dependencies
      }
    }, null, 2)
  );
  await writeFile(path.join(consumer, 'pnpm-workspace.yaml'), 'packages: []\n');
  await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
      lib: ['ESNext', 'DOM'],
      types: ['node']
    },
    include: ['smoke.ts']
  }, null, 2));
  await writeFile(path.join(consumer, 'smoke.ts'), consumerTypeSmoke());
  await writeFile(path.join(consumer, 'smoke.mjs'), consumerRuntimeSmoke());

  await exec('pnpm', ['install', '--prefer-offline'], { cwd: consumer });
  await exec('node', [path.join(repoRoot, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: consumer });
  await exec('node', ['smoke.mjs'], { cwd: consumer });
}

function consumerDependencies(consumer, packed) {
  return Object.fromEntries(packed.map(entry => [
    entry.name,
    `file:${path.relative(consumer, entry.tarball)}`
  ]));
}

function consumerTypeSmoke() {
  return `import { reactive, type AppHandle, type LamiError } from '@lami.js/runtime';
import { compileTemplate, type CompileResult } from '@lami.js/compiler';
import { renderRuntimeTemplate } from '@lami.js/ssr';
import { lami, type LamiPluginOptions } from '@lami.js/vite';
import { defineAsWebComponent } from '@lami.js/web-component';

const model = reactive({ name: 'Lami' });
const compileResult: CompileResult = compileTemplate('<p>\${name}</p>', { mode: 'dom' });
const options: LamiPluginOptions = { hydrate: true };
const plugin = lami(options);
const adapter: typeof defineAsWebComponent = defineAsWebComponent;
const handle: AppHandle | undefined = undefined;
const error: LamiError | undefined = undefined;

await renderRuntimeTemplate('<p>\${name}</p>', model);
void compileResult;
void plugin;
void adapter;
void handle;
void error;
`;
}

function consumerRuntimeSmoke() {
  return `import { reactive, effect, flushJobs } from '@lami.js/runtime';
import { compileTemplate } from '@lami.js/compiler';
import { renderRuntimeTemplate } from '@lami.js/ssr';
import { lami } from '@lami.js/vite';
import { defineAsWebComponent } from '@lami.js/web-component';

const model = reactive({ count: 0 });
let seen = -1;
effect(() => {
  seen = model.count;
});
model.count = 2;
await flushJobs();
if (seen !== 2) throw new Error('runtime reactivity smoke failed');

const rendered = await renderRuntimeTemplate('<p>\${name}</p>', { name: 'Lami' });
if (rendered !== '<p>Lami</p>') throw new Error('ssr smoke failed: ' + rendered);

const compiled = compileTemplate('<p>\${name}</p>', { mode: 'dom' });
if (!compiled.code.includes('createCompiledApp')) throw new Error('compiler smoke failed');
if (lami().name !== 'lami.js') throw new Error('vite plugin smoke failed');
if (typeof defineAsWebComponent !== 'function') throw new Error('web component smoke failed');
`;
}

async function tarList(tarball) {
  const { stdout } = await exec('tar', ['-tf', tarball]);
  return stdout.trim().split(/\r?\n/).filter(Boolean);
}

async function tarRead(tarball, file) {
  const { stdout } = await exec('tar', ['-xOf', tarball, file]);
  return stdout;
}
