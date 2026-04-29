#!/usr/bin/env node
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileTemplate, type CompileOptions } from './compile-template.js';

export interface CliResult {
  files: string[];
  warnings: Array<{ file: string; code: string; message: string }>;
}

interface ParsedArgs {
  command: string;
  inputs: string[];
  mode: CompileOptions['mode'];
  outDir: string;
  dev?: boolean;
}

export async function runCli(argv = process.argv.slice(2)): Promise<CliResult> {
  const args = parseArgs(argv);
  if (args.command !== 'compile') {
    throw new Error(usage(`Unknown command "${args.command}"`));
  }

  const inputs = await collectInputs(args.inputs);
  if (!inputs.length) throw new Error(usage('No input files matched'));

  const outputs: string[] = [];
  const warnings: CliResult['warnings'] = [];
  await mkdir(args.outDir, { recursive: true });

  for (const input of inputs) {
    const source = await readFile(input, 'utf8');
    const result = compileTemplate(source, {
      mode: args.mode,
      filename: input,
      ...(args.dev === undefined ? {} : { dev: args.dev })
    });
    const output = outputPath(input, args.outDir, args.mode);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, result.code);
    outputs.push(output);
    warnings.push(...result.warnings.map(warning => ({
      file: input,
      code: warning.code,
      message: warning.message
    })));
  }

  return { files: outputs, warnings };
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const inputs: string[] = [];
  let mode: CompileOptions['mode'] = 'dom';
  let outDir = '.lami';
  let dev: boolean | undefined;

  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!;
    switch (arg) {
      case '--mode': {
        const value = rest[++index];
        if (value !== 'dom' && value !== 'ssr' && value !== 'hydrate') {
          throw new Error(usage(`Invalid --mode "${value ?? ''}"`));
        }
        mode = value;
        break;
      }
      case '--outDir': {
        const value = rest[++index];
        if (!value) throw new Error(usage('--outDir requires a value'));
        outDir = value;
        break;
      }
      case '--dev':
        dev = true;
        break;
      case '--help':
      case '-h':
        throw new Error(usage());
      default:
        if (arg.startsWith('--')) throw new Error(usage(`Unknown option "${arg}"`));
        inputs.push(arg);
    }
  }

  return {
    command: command ?? '',
    inputs,
    mode,
    outDir,
    ...(dev === undefined ? {} : { dev })
  };
}

async function collectInputs(inputs: string[]): Promise<string[]> {
  const files = new Set<string>();
  for (const input of inputs) {
    const resolved = path.resolve(input);
    const info = await stat(resolved);
    if (info.isDirectory()) {
      for (const file of await walkHtml(resolved)) files.add(file);
    } else {
      files.add(resolved);
    }
  }
  return [...files].sort();
}

async function walkHtml(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkHtml(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }

  return files;
}

function outputPath(input: string, outDir: string, mode: CompileOptions['mode']): string {
  const ext = path.extname(input);
  const basename = path.basename(input, ext);
  return path.resolve(outDir, `${basename}.${mode}.js`);
}

function usage(error?: string): string {
  const text = [
    error,
    'Usage: lami compile <file-or-directory...> [--mode dom|ssr|hydrate] [--outDir .lami] [--dev]'
  ].filter(Boolean).join('\n');
  return text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
    .then(result => {
      for (const file of result.files) console.log(file);
      for (const warning of result.warnings) {
        console.warn(`${warning.file}: ${warning.code}: ${warning.message}`);
      }
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
