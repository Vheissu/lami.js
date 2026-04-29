import { describe, expect, it } from 'vitest';
import type { CompiledApp } from '@lami.js/runtime/internal';
import * as runtime from '@lami.js/runtime/internal';
import * as ssr from '@lami.js/ssr/internal';
import { compileTemplate } from '../src';

interface ExecutedDomModule {
  mount(target: Element, model: object, options?: Record<string, unknown>): CompiledApp;
}

interface ExecutedSsrModule {
  render(model: object, options?: Record<string, unknown>): Promise<string>;
}

interface ExecutedHydrateModule {
  hydrate(target: Element, model: object, options?: Record<string, unknown>): CompiledApp;
}

describe('rendering integration', () => {
  it('mounts compiled templates into real DOM and updates rendered HTML', async () => {
    const source = `
      <section class.bind="{ active: enabled }">
        <let title.bind="'Items: ' + items.length"></let>
        <h1>\${title}</h1>
        <p if.bind="enabled">Enabled for \${name}</p>
        <p else>Disabled</p>
        <ul>
          <li repeat.for="item of items; key: id">
            <span>\${$index}:\${item.label}</span>
            <strong if.bind="$first"> first</strong>
          </li>
        </ul>
        <input value.bind="name">
        <button @click="toggle()">Toggle</button>
      </section>
    `;
    const mod = executeDomModule(compileTemplate(source, { mode: 'dom' }).code);
    const target = document.createElement('div');
    const first = { id: 'a', label: 'Alpha' };
    const second = { id: 'b', label: 'Beta' };
    const model = {
      enabled: true,
      name: 'Ada',
      items: [first, second],
      toggle() {
        this.enabled = !this.enabled;
      }
    };

    const app = mod.mount(target, model);

    expect(renderedHtml(target)).toContain('<h1>Items: 2</h1>');
    expect(renderedHtml(target)).toContain('<p>Enabled for Ada</p>');
    expect(listText(target)).toEqual(['0:Alpha first', '1:Beta']);
    expect(target.querySelector('section')!.classList.contains('active')).toBe(true);

    const input = target.querySelector('input')!;
    input.value = 'Grace';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await app.flush();

    expect(renderedHtml(target)).toContain('<p>Enabled for Grace</p>');

    target.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    (app.scope.bindingContext as typeof model).items = [second, { id: 'c', label: 'Compiler' }];
    await app.flush();

    expect(renderedHtml(target)).toContain('<p>Disabled</p>');
    expect(renderedHtml(target)).toContain('<h1>Items: 2</h1>');
    expect(listText(target)).toEqual(['0:Beta first', '1:Compiler']);
    expect(target.querySelector('section')!.classList.contains('active')).toBe(false);
  });

  it('keeps optimized repeated event rows interactive in detached mounts', async () => {
    const source = `
      <section>
        <p>\${selected}</p>
        <button repeat.for="item of items; key: id" selected.class="selected === item.id" @click="select(item)">
          \${item.id}
        </button>
      </section>
    `;
    const mod = executeDomModule(compileTemplate(source, { mode: 'dom' }).code);
    const target = document.createElement('div');
    const model = {
      selected: 0,
      items: [{ id: 1 }, { id: 2 }],
      select(item: { id: number }) {
        this.selected = item.id;
      }
    };

    const app = mod.mount(target, model);
    const buttons = Array.from(target.querySelectorAll('button'));

    buttons[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await app.flush();

    expect((app.scope.bindingContext as typeof model).selected).toBe(2);
    expect(target.querySelector('p')!.textContent).toBe('2');
    expect(buttons[1]!.classList.contains('selected')).toBe(true);

    app.dispose();
    buttons[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect((app.scope.bindingContext as typeof model).selected).toBe(2);
  });

  it('server-renders, hydrates, and keeps real DOM interactive', async () => {
    const source = `
      <section title="Hello \${name}">
        <let title.bind="'Items: ' + items.length"></let>
        <h1>\${title}</h1>
        <p if.bind="enabled">Enabled for \${name}</p>
        <p else>Disabled</p>
        <ul>
          <li repeat.for="item of items; key: id">
            <span>\${$index}:\${item.label}</span>
            <strong if.bind="$first"> first</strong>
          </li>
        </ul>
        <input value.bind="name">
        <button @click="toggle()">Toggle</button>
      </section>
    `;
    const ssrModule = executeSsrModule(compileTemplate(source, { mode: 'ssr' }).code);
    const hydrateModule = executeHydrateModule(compileTemplate(source, { mode: 'hydrate' }).code);
    const target = document.createElement('div');
    const first = { id: 'a', label: 'Alpha' };
    const second = { id: 'b', label: 'Beta' };
    const model = {
      enabled: true,
      name: 'Ada',
      items: [first, second],
      toggle() {
        this.enabled = !this.enabled;
      }
    };

    const html = await ssrModule.render(model);

    expect(html).toContain('<h1>Items: 2</h1>');
    expect(html).toContain('<p>Enabled for Ada</p>');
    expect(html).toContain('<input value="Ada">');
    expect(html).not.toContain('repeat.for');
    expect(html).not.toContain('@click');

    target.innerHTML = html;
    const input = target.querySelector('input')!;
    const app = hydrateModule.hydrate(target, model);

    expect(renderedHtml(target)).toContain('<h1>Items: 2</h1>');
    expect(renderedHtml(target)).toContain('<p>Enabled for Ada</p>');
    expect(listText(target)).toEqual(['0:Alpha first', '1:Beta']);
    expect(input.value).toBe('Ada');

    input.value = 'Grace';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await app.flush();

    expect(renderedHtml(target)).toContain('<p>Enabled for Grace</p>');
    expect(target.querySelector('section')!.title).toBe('Hello Grace');

    target.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    (app.scope.bindingContext as typeof model).items = [second, { id: 'c', label: 'Hydrated' }];
    await app.flush();

    expect(renderedHtml(target)).toContain('<p>Disabled</p>');
    expect(listText(target)).toEqual(['0:Beta first', '1:Hydrated']);
  });
});

function renderedHtml(element: Element): string {
  return element.innerHTML
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
}

function listText(root: Element): string[] {
  return Array.from(root.querySelectorAll('li'), node => node.textContent?.trim().replace(/\s+/g, ' ') ?? '');
}

function executeDomModule(code: string): ExecutedDomModule {
  const runnable = replaceRuntimeImports(code)
    .replace('export const metadata =', 'const metadata =')
    .replace('export function mount', 'function mount');
  const factory = new Function('runtime', `${runnable}\nreturn { mount };`);

  return factory(runtime) as ExecutedDomModule;
}

function executeSsrModule(code: string): ExecutedSsrModule {
  const runnable = code
    .replace(
      /import\s+\{[\s\S]*?\}\s+from '@lami\.js\/runtime\/internal';/,
      `const {
        Scope,
        createRepeatLocals,
        createResourceRegistry,
        getIdentifier,
        materialize,
        parseExpression,
        setIdentifier
      } = runtime;`
    )
    .replace(
      /import\s+\{[\s\S]*?\}\s+from '@lami\.js\/ssr\/internal';/,
      `const {
        escapeHtml,
        renderAttrs
      } = ssr;`
    )
    .replace('export const metadata =', 'const metadata =')
    .replace('export async function render', 'async function render');
  const factory = new Function('runtime', 'ssr', `${runnable}\nreturn { render };`);

  return factory(runtime, ssr) as ExecutedSsrModule;
}

function executeHydrateModule(code: string): ExecutedHydrateModule {
  const runnable = replaceRuntimeImports(code)
    .replace('export const metadata =', 'const metadata =')
    .replace('export function hydrate', 'function hydrate')
    .replace('export const mount = hydrate;', 'const mount = hydrate;');
  const factory = new Function('runtime', `${runnable}\nreturn { hydrate };`);

  return factory(runtime) as ExecutedHydrateModule;
}

function replaceRuntimeImports(code: string): string {
  return code.replace(
    /import\s+\{[\s\S]*?\}\s+from '@lami\.js\/runtime\/internal';/,
    `const {
      addOptimizedEventListener,
      bindAttributeCompiled,
      bindClassCompiled,
      bindClassOptimizedCompiled,
      bindEventCompiled,
      bindIfCompiled,
      bindLetCompiled,
      bindPromiseCompiled,
      bindPropertyCompiled,
      bindPropertyOptimizedCompiled,
      bindRefCompiled,
      bindRepeatCompiled,
      bindRepeatOptimizedCompiled,
      bindShowCompiled,
      bindSpreadCompiled,
      bindStyleCompiled,
      bindSwitchCompiled,
      bindTextCompiled,
      bindTextOptimizedCompiled,
      bindWithCompiled,
      createCompiledApp,
      createCompiledViewFactory,
      createOptimizedRepeatRow,
      createOptimizedRepeatRowFromNodes,
      createTemplate,
      getIdentifier,
      path,
      setIdentifier
    } = runtime;`
  );
}
