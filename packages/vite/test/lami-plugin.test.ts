import { describe, expect, it } from 'vitest';
import type { Plugin } from 'vite';
import { lami } from '../src';

describe('lami vite plugin', () => {
  it('transforms matching Lami templates with DOM codegen by default', async () => {
    const result = await transform(lami(), '<input value.bind="email">', '/app/contact.lami.html');

    expect(result?.code).toContain('createCompiledApp');
    expect(result?.code).toContain('bindPropertyCompiled');
  });

  it('honors hydrate mode for matching templates', async () => {
    const result = await transform(lami({ hydrate: true }), '<p>${message}</p>', '/app/message.lami.html');

    expect(result?.code).toContain('export function hydrate');
    expect(result?.code).toContain('export const mount = hydrate');
    expect(result?.code).toContain('createCompiledApp');
    expect(result?.code).not.toContain("import { enhance } from '@lami.js/runtime';");
    expect(result?.code).not.toContain('target.append');
  });

  it('emits direct hydrate modules for controller templates', async () => {
    const result = await transform(
      lami({ hydrate: true }),
      '<ul><li repeat.for="item of items"><span if.bind="$first">${item}</span></li></ul>',
      '/app/list.lami.html'
    );

    expect(result?.code).toContain('hydrateRepeatController');
    expect(result?.code).toContain('bindIfCompiled');
    expect(result?.code).toContain('hydratePath');
    expect(result?.code).not.toContain("import { enhance } from '@lami.js/runtime';");
  });

  it('honors ssr mode with direct render modules', async () => {
    const result = await transform(lami({ ssr: true }), '<p>${message}</p>', '/app/message.lami.html');

    expect(result?.code).toContain('export async function render');
    expect(result?.code).toContain('escapeHtml');
    expect(result?.code).not.toContain('renderRuntimeTemplate');
  });

  it('ignores files outside the include pattern', async () => {
    const result = await transform(lami(), '<p>${message}</p>', '/app/message.html');

    expect(result).toBeNull();
  });
});

async function transform(plugin: Plugin, code: string, id: string): Promise<{ code: string; map: unknown } | null> {
  const hook = plugin.transform;
  if (!hook) throw new Error('Expected transform hook');

  const handler = typeof hook === 'function' ? hook : hook.handler;
  return await handler.call({} as never, code, id) as { code: string; map: unknown } | null;
}
