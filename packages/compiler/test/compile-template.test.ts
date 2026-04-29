import { describe, expect, it } from 'vitest';
import type { CompiledApp } from '@lami.js/runtime/internal';
import * as runtime from '@lami.js/runtime/internal';
import * as ssr from '@lami.js/ssr/internal';
import { compileTemplate, compileToIr, parseTemplateAst } from '../src';

interface ExecutedDomModule {
  metadata: unknown;
  mount(target: Element, model: object, options?: Record<string, unknown>): CompiledApp;
}

interface ExecutedSsrModule {
  metadata: unknown;
  render(model: object, options?: Record<string, unknown>): Promise<string>;
}

interface ExecutedHydrateModule {
  metadata: unknown;
  hydrate(target: Element, model: object, options?: Record<string, unknown>): CompiledApp;
  mount(target: Element, model: object, options?: Record<string, unknown>): CompiledApp;
}

describe('compiler pipeline', () => {
  it('normalizes parse5 nodes into a template AST', () => {
    const ast = parseTemplateAst(`
      <template switch.bind="status">
        <p case="pending">Pending</p>
      </template>
    `);

    const template = ast.root.children.find(node => node.kind === 'element' && node.tagName === 'template');

    expect(template).toMatchObject({
      kind: 'element',
      tagName: 'template',
      attrs: [
        {
          name: 'switch.bind',
          syntax: {
            target: 'switch',
            command: 'bind'
          }
        }
      ]
    });
    expect(template?.kind === 'element' ? template.children.some(node => node.kind === 'element' && node.tagName === 'p') : false).toBe(true);
  });

  it('extracts expressions and binding instructions into IR', () => {
    const ir = compileToIr(`
      <form submit.trigger="submit($event)">
        <input value.bind="email">
        <button disabled.bind="!email.includes('@')">Submit</button>
        <p if.bind="email">Sending to \${email}</p>
      </form>
    `);

    expect(ir.bindings.map(binding => binding.kind)).toEqual([
      'event',
      'property',
      'property',
      'templateController'
    ]);
    expect(ir.expressions.map(expression => expression.source)).toEqual([
      'submit($event)',
      'email',
      "!email.includes('@')",
      'email'
    ]);
    expect(ir.factories).toHaveLength(1);
    expect(ir.staticHtml).toContain('<form>');
    expect(ir.staticHtml).toContain('<input>');
    expect(ir.staticHtml).toContain('<button>Submit</button>');
    expect(ir.staticHtml).toContain('<!--lami:if:0-->');
    expect(ir.staticHtml).not.toContain('submit.trigger');
    expect(ir.staticHtml).not.toContain('value.bind');
  });

  it('includes compiler metadata in compileTemplate results', () => {
    const result = compileTemplate(`<input value.bind="email">`, {
      mode: 'dom',
      filename: 'contact.html'
    });

    expect(result.metadata).toMatchObject({
      mode: 'dom',
      filename: 'contact.html',
      nodeCount: 1
    });
    expect(result.metadata.ir.bindings).toHaveLength(1);
    expect(result.metadata.ir.bindings[0]).toMatchObject({
      kind: 'property',
      target: 'value',
      mode: 'twoWay'
    });
    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('export const metadata');
    expect(result.code).toContain('createCompiledApp');
    expect(result.code).toContain('bindPropertyCompiled');
    expect(result.code).not.toContain('enhance(target');
    expect(result.code).toContain('export function mount');
  });

  it('emits direct DOM modules that mount live bindings', async () => {
    const result = compileTemplate(`
      <section title="User \${name}">
        <let display-name.bind="'Hello ' + name"></let>
        <h1>\${displayName}</h1>
        <h2>\${name | upper}</h2>
        <input value.bind="name">
        <span show.bind="!locked">Editable</span>
        <p active.class="highlighted" style.background-color.bind="color">Status</p>
        <button disabled.bind="locked" click.trigger="save()">Save</button>
      </section>
    `, {
      mode: 'dom',
      filename: 'profile.lami.html'
    });
    const mod = executeDomModule(result.code);
    const target = document.createElement('div');
    const model = {
      name: 'Ada',
      locked: false,
      highlighted: true,
      color: 'red',
      save() {
        this.locked = true;
        this.highlighted = false;
        this.color = 'green';
        this.name = `Saved ${this.name}`;
      }
    };

    const app = mod.mount(target, model, {
      resources: {
        converters: {
          upper: {
            toView(value: unknown) {
              return String(value).toUpperCase();
            }
          }
        }
      }
    });
    const section = target.querySelector('section')!;
    const heading = target.querySelector('h1')!;
    const convertedHeading = target.querySelector('h2')!;
    const input = target.querySelector('input')!;
    const status = target.querySelector('span')!;
    const paragraph = target.querySelector('p')!;
    const button = target.querySelector('button')!;

    expect(result.warnings).toEqual([]);
    expect(mod.metadata).toEqual(result.metadata.ir);
    expect(result.code).toContain('bindClassCompiled');
    expect(result.code).toContain('bindLetCompiled');
    expect(result.code).toContain('bindShowCompiled');
    expect(result.code).toContain('bindStyleCompiled');
    expect(result.code).toContain('evaluate(scope)');
    expect(section.title).toBe('User Ada');
    expect(heading.textContent).toBe('Hello Ada');
    expect(convertedHeading.textContent).toBe('ADA');
    expect(input.value).toBe('Ada');
    expect(status.style.display).toBe('');
    expect(paragraph.classList.contains('active')).toBe(true);
    expect(paragraph.style.backgroundColor).toBe('red');
    expect(button.disabled).toBe(false);

    input.value = 'Grace';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await app.flush();

    expect(section.title).toBe('User Grace');
    expect(heading.textContent).toBe('Hello Grace');
    expect(convertedHeading.textContent).toBe('GRACE');

    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await app.flush();

    expect(section.title).toBe('User Saved Grace');
    expect(heading.textContent).toBe('Hello Saved Grace');
    expect(status.style.display).toBe('none');
    expect(paragraph.classList.contains('active')).toBe(false);
    expect(paragraph.style.backgroundColor).toBe('green');
    expect(button.disabled).toBe(true);

    app.dispose();
  });

  it('emits direct DOM modules for simple if/else and repeat controllers', async () => {
    const result = compileTemplate(`
      <section>
        <p if.bind="show">Visible \${items.length}</p>
        <p else>Hidden</p>
        <ul>
          <li repeat.for="item of items; key: id">\${$index}: \${item.name}<small if.bind="$first"> first</small></li>
        </ul>
        <article with.bind="selectedUser">
          <strong>\${name}</strong>
        </article>
      </section>
    `, {
      mode: 'dom',
      filename: 'controllers.lami.html'
    });
    const mod = executeDomModule(result.code);
    const target = document.createElement('div');
    const first = { id: 'a', name: 'A' };
    const second = { id: 'b', name: 'B' };
    const model = {
      show: true,
      items: [first, second],
      selectedUser: { name: 'Ada' }
    };

    const app = mod.mount(target, model);
    const [nodeA, nodeB] = Array.from(target.querySelectorAll('li'));

    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('bindIfCompiled');
    expect(result.code).toContain('bindRepeatCompiled');
    expect(result.code).toContain('bindWithCompiled');
    expect(result.code).toContain('createCompiledViewFactory');
    expect(target.querySelector('p')!.textContent).toBe('Visible 2');
    expect(Array.from(target.querySelectorAll('li'), node => node.textContent)).toEqual(['0: A first', '1: B']);
    expect(target.querySelector('strong')!.textContent).toBe('Ada');

    (app.scope.bindingContext as typeof model).show = false;
    (app.scope.bindingContext as typeof model).items = [
      second,
      { id: 'c', name: 'C' },
      first
    ];
    (app.scope.bindingContext as typeof model).selectedUser = { name: 'Grace' };
    await app.flush();

    const nodes = Array.from(target.querySelectorAll('li'));
    expect(target.querySelector('p')!.textContent).toBe('Hidden');
    expect(nodes.map(node => node.textContent)).toEqual(['0: B first', '1: C', '2: A']);
    expect(nodes[0]).toBe(nodeB);
    expect(nodes[2]).toBe(nodeA);
    expect(target.querySelector('strong')!.textContent).toBe('Grace');

    app.dispose();
  });

  it('keeps simple show bindings inside optimized compiled repeat rows', async () => {
    const result = compileTemplate(`
      <ul>
        <li repeat.for="item of items; key: id">
          <span show.bind="item.visible">\${item.name}</span>
        </li>
      </ul>
    `, {
      mode: 'dom',
      filename: 'show-repeat.lami.html'
    });
    const mod = executeDomModule(result.code);
    const target = document.createElement('div');
    const model = {
      items: [
        { id: 1, name: 'Shown', visible: true },
        { id: 2, name: 'Hidden', visible: false }
      ]
    };

    const app = mod.mount(target, model);
    const spans = target.querySelectorAll<HTMLElement>('span');

    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('createOptimizedRepeatRowFromNodes');
    expect(result.code).toContain('style.display');
    expect(spans[0]!.style.display).toBe('');
    expect(spans[1]!.style.display).toBe('none');

    (app.scope.bindingContext as typeof model).items = [
      { id: 1, name: 'Shown', visible: false },
      { id: 2, name: 'Hidden', visible: true }
    ];
    await app.flush();

    expect(spans[0]!.style.display).toBe('none');
    expect(spans[1]!.style.display).toBe('');

    app.dispose();
  });

  it('emits direct DOM modules for lightweight custom elements inside repeat views', async () => {
    const attachedUsers: string[] = [];
    class UserCard {
      user = { id: 0, name: '', done: false };

      toggle() {
        this.user.done = !this.user.done;
      }

      attached() {
        attachedUsers.push(this.user.name);
      }
    }

    const result = compileTemplate(`
      <main>
        <user-card repeat.for="item of items; key: id" user.bind="item">
          <button slot="actions" click.trigger="select(item)">\${count}</button>
          <p>\${item.name}</p>
        </user-card>
      </main>
    `, {
      mode: 'dom',
      filename: 'compiled-components.lami.html'
    });
    const mod = executeDomModule(result.code);
    const target = document.createElement('div');
    const model = {
      count: 0,
      selected: 0,
      items: [
        { id: 1, name: 'Ada', done: true },
        { id: 2, name: 'Grace', done: false }
      ],
      select(item: { id: number }) {
        this.count++;
        this.selected = item.id;
      }
    };

    const app = mod.mount(target, model, {
      resources: {
        elements: {
          'user-card': {
            name: 'user-card',
            Type: UserCard,
            bindables: {
              user: {}
            },
            template: `
              <article done.class="user.done" title.bind="'Card ' + user.name" style.border-color.bind="user.done ? 'green' : 'gray'">
                <header>\${user.name}<slot name="actions"></slot></header>
                <small show.bind="user.done" data-user="\${user.name}">done</small>
                <button click.trigger="toggle()">toggle</button>
                <section><slot></slot></section>
              </article>
            `
          }
        }
      }
    });

    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('prepareCustomElementCompiled');
    expect(result.code).toContain('bindCustomElementCompiled');
    expect(result.code).not.toContain('enhance(target');
    expect(result.code).toContain('bindRepeatCompiled');
    expect(attachedUsers).toEqual(['Ada', 'Grace']);
    const articles = target.querySelectorAll<HTMLElement>('article');
    expect(Array.from(articles, node => node.querySelector('header')?.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Ada0',
      'Grace0'
    ]);
    expect(Array.from(articles, node => node.querySelector('section')?.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Ada',
      'Grace'
    ]);
    expect(articles[0]!.classList.contains('done')).toBe(true);
    expect(articles[0]!.title).toBe('Card Ada');
    expect(articles[0]!.style.borderColor).toBe('green');
    expect(articles[0]!.querySelector('small')!.style.display).toBe('');
    expect(articles[0]!.querySelector('small')!.getAttribute('data-user')).toBe('Ada');
    expect(articles[1]!.querySelector('small')!.style.display).toBe('none');

    target.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await app.flush();

    expect(model.count).toBe(1);
    expect(model.selected).toBe(1);
    expect(Array.from(target.querySelectorAll('button[slot="actions"]'), node => node.textContent)).toEqual(['1', '1']);

    articles[0]!.querySelector('button:not([slot])')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await app.flush();

    expect(articles[0]!.classList.contains('done')).toBe(false);
    expect(articles[0]!.style.borderColor).toBe('gray');
    expect(articles[0]!.querySelector('small')!.style.display).toBe('none');

    (app.scope.bindingContext as typeof model).items = [
      { id: 2, name: 'Grace Hopper', done: true },
      { id: 3, name: 'Katherine', done: false }
    ];
    await app.flush();

    expect(Array.from(target.querySelectorAll('article'), node => node.querySelector('header')?.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Grace Hopper1',
      'Katherine1'
    ]);

    app.dispose();
  });

  it('returns Elm-style compiler diagnostics for fast-path misses', () => {
    const result = compileTemplate(`
      <ul>
        <li repeat.for="item of items">
          <span style.color.bind="item.color">\${item.name}</span>
        </li>
      </ul>
    `, {
      mode: 'dom',
      filename: 'diagnostics.lami.html',
      dev: true
    });

    expect(result.warnings).toEqual([]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'I_COMPILER_DIRECT_DOM',
        severity: 'info',
        title: 'Direct DOM output selected'
      }),
      expect.objectContaining({
        code: 'I_OPTIMIZED_ROW_MISS',
        severity: 'info',
        title: 'Repeat row uses the generic view path',
        message: 'Style bindings inside repeat rows stay on the generic view path for now.',
        loc: expect.objectContaining({
          line: expect.any(Number),
          column: expect.any(Number)
        }),
        source: expect.stringContaining('style.color.bind'),
        hint: expect.stringContaining('Rows are fastest')
      })
    ]));
  });

  it('emits direct DOM modules for switch controllers', async () => {
    const result = compileTemplate(`
      <template switch.bind="status">
        <p case="pending">Pending \${count}</p>
        <p case.bind="readyStates">Ready</p>
        <p default-case>Unknown</p>
      </template>
    `, {
      mode: 'dom',
      filename: 'switch.lami.html'
    });
    const mod = executeDomModule(result.code);
    const target = document.createElement('div');
    const model = {
      status: 'pending',
      readyStates: ['ready', 'complete'],
      count: 1
    };

    const app = mod.mount(target, model);

    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('bindSwitchCompiled');
    expect(target.querySelector('p')!.textContent).toBe('Pending 1');

    (app.scope.bindingContext as typeof model).count = 2;
    await app.flush();
    expect(target.querySelector('p')!.textContent).toBe('Pending 2');

    (app.scope.bindingContext as typeof model).status = 'ready';
    await app.flush();
    expect(target.querySelector('p')!.textContent).toBe('Ready');

    (app.scope.bindingContext as typeof model).status = 'missing';
    await app.flush();
    expect(target.querySelector('p')!.textContent).toBe('Unknown');

    app.dispose();
  });

  it('emits direct DOM modules for promise controllers', async () => {
    let resolveRequest!: (value: { name: string }) => void;
    let rejectRequest!: (error: Error) => void;
    const request = new Promise<{ name: string }>((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    const result = compileTemplate(`
      <div promise.bind="request" class="request">
        <span pending>Loading</span>
        <strong then="user">\${user.name}</strong>
        <em catch="error">\${error.message}</em>
      </div>
    `, {
      mode: 'dom',
      filename: 'promise.lami.html'
    });
    const mod = executeDomModule(result.code);
    const target = document.createElement('div');
    const model = { request };

    const app = mod.mount(target, model);

    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('bindPromiseCompiled');
    expect(target.querySelector('div.request')).not.toBeNull();
    expect(target.querySelector('span')!.textContent).toBe('Loading');

    resolveRequest({ name: 'Ada' });
    await Promise.resolve();
    await app.flush();

    expect(target.querySelector('strong')!.textContent).toBe('Ada');
    expect(target.querySelector('span')).toBeNull();

    (app.scope.bindingContext as typeof model).request = new Promise((_resolve, reject) => {
      rejectRequest = reject;
    });
    await app.flush();
    expect(target.querySelector('span')!.textContent).toBe('Loading');

    rejectRequest(new Error('Nope'));
    await Promise.resolve();
    await app.flush();

    expect(target.querySelector('em')!.textContent).toBe('Nope');

    app.dispose();
  });

  it('emits direct SSR modules for bindings and controllers', async () => {
    const result = compileTemplate(`
      <section title="\${title}" class.bind="classes" active.class="enabled" style.background-color.bind="bg" show.bind="visible" ...extra-attrs>
        <let greeting.bind="'Hello ' + user.name"></let>
        <h1>\${greeting}</h1>
        <h2>\${user.name | upper}</h2>
        <p if.bind="enabled">On</p>
        <p else>Off</p>
        <ul>
          <li repeat.for="item of items">\${$index}:\${item}</li>
        </ul>
        <article with.bind="user">
          <strong>\${name}</strong>
        </article>
        <template switch.bind="status">
          <span case="pending">Pending</span>
          <span case.bind="readyStates">Ready</span>
          <span default-case>Unknown</span>
        </template>
        <div promise.bind="request">
          <span pending>Loading</span>
          <b then="value">\${value}</b>
          <i catch="error">\${error.message}</i>
        </div>
      </section>
    `, {
      mode: 'ssr',
      filename: 'page.lami.html'
    });
    const mod = executeSsrModule(result.code);
    const resources = {
      converters: {
        upper: {
          toView(value: unknown) {
            return String(value).toUpperCase();
          }
        }
      }
    };
    const html = await mod.render({
      title: '<Title>',
      classes: { card: true },
      enabled: true,
      bg: 'red',
      visible: false,
      extraAttrs: {
        'data-state': 'ready'
      },
      user: { name: 'Ada' },
      items: ['a', 'b'],
      status: 'ready',
      readyStates: ['ready', 'complete'],
      request: Promise.resolve('<ok>')
    }, { resources });

    expect(result.warnings).toEqual([]);
    expect(mod.metadata).toEqual(result.metadata.ir);
    expect(result.code).toContain('export async function render');
    expect(result.code).not.toContain('renderRuntimeTemplate');
    expect(html).toContain('title="&lt;Title&gt;"');
    expect(html).toContain('class="card active"');
    expect(html).toContain('style="background-color: red; display: none"');
    expect(html).toContain('data-state="ready"');
    expect(html).toContain('<h1>Hello Ada</h1>');
    expect(html).toContain('<h2>ADA</h2>');
    expect(html).toContain('<p>On</p>');
    expect(html).not.toContain('<p>Off</p>');
    expect(html).toContain('<li>0:a</li>');
    expect(html).toContain('<li>1:b</li>');
    expect(html).toContain('<strong>Ada</strong>');
    expect(html).toContain('<span>Ready</span>');
    expect(html).toContain('<b>&lt;ok&gt;</b>');
    expect(html).not.toContain('Loading');

    const fallbackHtml = await mod.render({
      title: 'Fallback',
      classes: [],
      enabled: false,
      bg: 'green',
      visible: true,
      extraAttrs: {},
      user: { name: 'Grace' },
      items: [],
      status: 'missing',
      readyStates: ['ready'],
      request: Promise.reject(new Error('Nope & no'))
    }, { resources });

    expect(fallbackHtml).toContain('<p>Off</p>');
    expect(fallbackHtml).toContain('<h2>GRACE</h2>');
    expect(fallbackHtml).not.toContain('display: none');
    expect(fallbackHtml).toContain('<span>Unknown</span>');
    expect(fallbackHtml).toContain('<i>Nope &amp; no</i>');
  });

  it('emits direct hydration modules for existing SSR DOM without recreating nodes', async () => {
    const source = `
      <section title="\${title}" class.bind="classes" active.class="enabled" style.background-color.bind="bg">
        <h1>\${message}</h1>
        <input value.bind="message">
        <button click.trigger="save()">Save</button>
      </section>
    `;
    const ssrModule = executeSsrModule(compileTemplate(source, { mode: 'ssr' }).code);
    const result = compileTemplate(source, {
      mode: 'hydrate',
      filename: 'message.lami.html'
    });
    const mod = executeHydrateModule(result.code);
    const target = document.createElement('div');
    const model = {
      title: 'Greeting',
      classes: ['card'],
      enabled: true,
      bg: 'red',
      message: 'Hello',
      save() {
        this.message = 'Saved';
      }
    };
    target.innerHTML = await ssrModule.render(model);
    const section = target.querySelector('section')!;
    const input = target.querySelector('input')!;
    const button = target.querySelector('button')!;

    const app = mod.hydrate(target, model);

    expect(result.warnings).toEqual([]);
    expect(result.metadata.mode).toBe('hydrate');
    expect(result.code).toContain('export function hydrate');
    expect(result.code).toContain('export const mount = hydrate');
    expect(result.code).not.toContain('target.append');
    expect(target.querySelector('section')).toBe(section);
    expect(section.title).toBe('Greeting');
    expect(section.classList.contains('card')).toBe(true);
    expect(section.classList.contains('active')).toBe(true);
    expect(section.style.backgroundColor).toBe('red');
    expect(target.querySelector('h1')!.textContent).toBe('Hello');
    expect(input.value).toBe('Hello');

    input.value = 'Typed';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await app.flush();

    expect(target.querySelector('h1')!.textContent).toBe('Typed');

    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await app.flush();

    expect(target.querySelector('h1')!.textContent).toBe('Saved');
  });

  it('hydrates SSR if controller ranges from markers', async () => {
    const source = `<section><p if.bind="show">Visible \${message}</p><p else>Hidden</p></section>`;
    const ssrModule = executeSsrModule(compileTemplate(source, { mode: 'ssr' }).code);
    const result = compileTemplate(source, {
      mode: 'hydrate',
      filename: 'if.lami.html'
    });
    const mod = executeHydrateModule(result.code);
    const target = document.createElement('div');
    const model = {
      show: true,
      message: 'Hello'
    };

    target.innerHTML = await ssrModule.render(model);
    expect(target.innerHTML).toContain('lami:if:');
    expect(target.querySelectorAll('section > p')).toHaveLength(1);

    const app = mod.hydrate(target, model);

    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('hydrateIfController');
    expect(result.code).toContain('bindIfCompiled');
    expect(target.querySelectorAll('section > p')).toHaveLength(1);
    expect(target.querySelector('p')!.textContent).toBe('Visible Hello');

    (app.scope.bindingContext as typeof model).show = false;
    await app.flush();

    expect(target.querySelectorAll('section > p')).toHaveLength(1);
    expect(target.querySelector('p')!.textContent).toBe('Hidden');

    (app.scope.bindingContext as typeof model).show = true;
    (app.scope.bindingContext as typeof model).message = 'Again';
    await app.flush();

    expect(target.querySelectorAll('section > p')).toHaveLength(1);
    expect(target.querySelector('p')!.textContent).toBe('Visible Again');
  });

  it('hydrates SSR repeat controller ranges from markers', async () => {
    const source = `<ul><li repeat.for="item of items">\${$index}:\${item}</li></ul>`;
    const ssrModule = executeSsrModule(compileTemplate(source, { mode: 'ssr' }).code);
    const result = compileTemplate(source, {
      mode: 'hydrate',
      filename: 'repeat.lami.html'
    });
    const mod = executeHydrateModule(result.code);
    const target = document.createElement('div');
    const model = {
      items: ['a', 'b']
    };

    target.innerHTML = await ssrModule.render(model);
    expect(target.innerHTML).toContain('lami:repeat:');
    expect(Array.from(target.querySelectorAll('li'), node => node.textContent)).toEqual(['0:a', '1:b']);

    const app = mod.hydrate(target, model);

    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('hydrateRepeatController');
    expect(result.code).toContain('bindRepeatCompiled');
    expect(Array.from(target.querySelectorAll('li'), node => node.textContent)).toEqual(['0:a', '1:b']);

    (app.scope.bindingContext as typeof model).items = ['b', 'c', 'd'];
    await app.flush();

    expect(Array.from(target.querySelectorAll('li'), node => node.textContent)).toEqual(['0:b', '1:c', '2:d']);
  });

  it('hydrates SSR with controller ranges from markers', async () => {
    const source = `<article with.bind="user"><h2>\${name}</h2></article>`;
    const ssrModule = executeSsrModule(compileTemplate(source, { mode: 'ssr' }).code);
    const result = compileTemplate(source, {
      mode: 'hydrate',
      filename: 'with.lami.html'
    });
    const mod = executeHydrateModule(result.code);
    const target = document.createElement('div');
    const model = {
      user: { name: 'Ada' }
    };

    target.innerHTML = await ssrModule.render(model);
    expect(target.innerHTML).toContain('lami:with:');
    expect(target.querySelector('h2')!.textContent).toBe('Ada');

    const app = mod.hydrate(target, model);

    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('hydrateWithController');
    expect(target.querySelector('h2')!.textContent).toBe('Ada');

    (app.scope.bindingContext as typeof model).user = { name: 'Grace' };
    await app.flush();

    expect(target.querySelector('h2')!.textContent).toBe('Grace');
  });

  it('hydrates SSR switch controller ranges from markers', async () => {
    const source = `
      <template switch.bind="status">
        <p case="pending">Pending \${count}</p>
        <p case.bind="readyStates">Ready</p>
        <p default-case>Unknown</p>
      </template>
    `;
    const ssrModule = executeSsrModule(compileTemplate(source, { mode: 'ssr' }).code);
    const result = compileTemplate(source, {
      mode: 'hydrate',
      filename: 'switch.lami.html'
    });
    const mod = executeHydrateModule(result.code);
    const target = document.createElement('div');
    const model = {
      status: 'pending',
      count: 1,
      readyStates: ['ready', 'complete']
    };

    target.innerHTML = await ssrModule.render(model);
    expect(target.innerHTML).toContain('lami:switch:');
    expect(target.querySelector('p')!.textContent).toBe('Pending 1');

    const app = mod.hydrate(target, model);

    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('hydrateSwitchController');
    expect(target.querySelector('p')!.textContent).toBe('Pending 1');

    (app.scope.bindingContext as typeof model).count = 2;
    await app.flush();
    expect(target.querySelector('p')!.textContent).toBe('Pending 2');

    (app.scope.bindingContext as typeof model).status = 'ready';
    await app.flush();
    expect(target.querySelector('p')!.textContent).toBe('Ready');

    (app.scope.bindingContext as typeof model).status = 'missing';
    await app.flush();
    expect(target.querySelector('p')!.textContent).toBe('Unknown');
  });

  it('hydrates SSR promise controller ranges from markers', async () => {
    const source = `
      <div class="box" promise.bind="request">
        <span pending>Loading</span>
        <b then="value">\${value}</b>
        <i catch="error">\${error.message}</i>
      </div>
    `;
    const ssrModule = executeSsrModule(compileTemplate(source, { mode: 'ssr' }).code);
    const result = compileTemplate(source, {
      mode: 'hydrate',
      filename: 'promise.lami.html'
    });
    const mod = executeHydrateModule(result.code);
    const target = document.createElement('div');
    let resolveRequest: (value: string) => void = () => undefined;
    let rejectRequest: (error: Error) => void = () => undefined;
    const model = {
      request: 'Ready'
    };

    target.innerHTML = await ssrModule.render(model);
    expect(target.innerHTML).toContain('lami:promise:');
    expect(target.querySelector('.box')).not.toBeNull();
    expect(target.querySelector('b')!.textContent).toBe('Ready');

    const app = mod.hydrate(target, model);

    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('hydratePromiseController');
    expect(result.code).toContain('bindPromiseCompiled');
    expect(target.querySelector('.box')).not.toBeNull();
    expect(target.querySelector('b')!.textContent).toBe('Ready');

    (app.scope.bindingContext as typeof model).request = new Promise(resolve => {
      resolveRequest = resolve;
    }) as unknown as string;
    await app.flush();
    expect(target.querySelector('span')!.textContent).toBe('Loading');

    resolveRequest('Later');
    await Promise.resolve();
    await app.flush();
    expect(target.querySelector('b')!.textContent).toBe('Later');

    (app.scope.bindingContext as typeof model).request = new Promise((_resolve, reject) => {
      rejectRequest = reject;
    }) as unknown as string;
    await app.flush();
    expect(target.querySelector('span')!.textContent).toBe('Loading');

    rejectRequest(new Error('Nope'));
    await Promise.resolve();
    await app.flush();
    expect(target.querySelector('i')!.textContent).toBe('Nope');
  });

  it('hydrates SSR let bindings without shifting later DOM paths', async () => {
    const source = `<section><let label.bind="'Hello ' + name"></let><p>\${label}</p></section>`;
    const ssrModule = executeSsrModule(compileTemplate(source, { mode: 'ssr' }).code);
    const result = compileTemplate(source, {
      mode: 'hydrate',
      filename: 'let.lami.html'
    });
    const mod = executeHydrateModule(result.code);
    const target = document.createElement('div');
    const model = {
      name: 'Ada'
    };

    target.innerHTML = await ssrModule.render(model);
    expect(target.innerHTML).toContain('lami:let');
    expect(target.querySelector('p')!.textContent).toBe('Hello Ada');

    const app = mod.hydrate(target, model);

    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('bindLetCompiled');
    expect(result.code).not.toContain('enhance(target');
    expect(target.querySelector('p')!.textContent).toBe('Hello Ada');

    (app.scope.bindingContext as typeof model).name = 'Grace';
    await app.flush();

    expect(target.querySelector('p')!.textContent).toBe('Hello Grace');
  });

  it('hydrates mixed controller ranges and later path-stable bindings', async () => {
    const source = `<section><p if.bind="show">On \${message}</p><p else>Off</p><h1>\${title}</h1></section>`;
    const ssrModule = executeSsrModule(compileTemplate(source, { mode: 'ssr' }).code);
    const result = compileTemplate(source, {
      mode: 'hydrate',
      filename: 'mixed.lami.html'
    });
    const mod = executeHydrateModule(result.code);
    const target = document.createElement('div');
    const model = {
      show: true,
      message: 'Hello',
      title: 'Greeting'
    };

    target.innerHTML = await ssrModule.render(model);
    expect(target.innerHTML).toContain('lami:if:');
    expect(target.innerHTML).toContain('lami:else');
    expect(target.querySelector('p')!.textContent).toBe('On Hello');
    expect(target.querySelector('h1')!.textContent).toBe('Greeting');

    const app = mod.hydrate(target, model);

    expect(result.warnings).toEqual([]);
    expect(result.code).toContain('hydratePath');
    expect(result.code).toContain('hydrateIfController');
    expect(target.querySelector('p')!.textContent).toBe('On Hello');
    expect(target.querySelector('h1')!.textContent).toBe('Greeting');

    (app.scope.bindingContext as typeof model).show = false;
    (app.scope.bindingContext as typeof model).title = 'Changed';
    await app.flush();

    expect(target.querySelector('p')!.textContent).toBe('Off');
    expect(target.querySelector('h1')!.textContent).toBe('Changed');
  });

  it('hydrates nested controller factories after parent range replacement', async () => {
    const source = `
      <ul>
        <li repeat.for="item of items">
          <strong if.bind="$first">\${item}</strong>
          <span else>\${item}</span>
        </li>
      </ul>
    `;
    const ssrModule = executeSsrModule(compileTemplate(source, { mode: 'ssr' }).code);
    const result = compileTemplate(source, {
      mode: 'hydrate',
      filename: 'nested.lami.html'
    });
    const mod = executeHydrateModule(result.code);
    const target = document.createElement('div');
    const model = {
      items: ['a', 'b']
    };

    target.innerHTML = await ssrModule.render(model);
    expect(target.innerHTML).toContain('lami:repeat:');
    expect(target.innerHTML).toContain('lami:if:');

    const app = mod.hydrate(target, model);

    expect(result.warnings).toEqual([]);
    expect(result.code).not.toContain('enhance(target');
    expect(result.code).toContain('bindIfCompiled');
    expect(Array.from(target.querySelectorAll('li'), node => node.textContent?.trim().replace(/\s+/g, ' '))).toEqual(['a', 'b']);
    expect(target.querySelector('li:first-child strong')!.textContent).toBe('a');
    expect(target.querySelector('li:last-child span')!.textContent).toBe('b');

    (app.scope.bindingContext as typeof model).items = ['x'];
    await app.flush();

    expect(target.querySelectorAll('li')).toHaveLength(1);
    expect(target.querySelector('strong')!.textContent).toBe('x');
    expect(target.querySelector('span')).toBeNull();
  });
});

function executeDomModule(code: string): ExecutedDomModule {
  const runnable = code
    .replace(
      /import\s+\{[\s\S]*?\}\s+from '@lami\.js\/runtime\/internal';/,
      `const {
        addOptimizedEventListener,
        bindAttributeCompiled,
        bindClassCompiled,
        bindClassOptimizedCompiled,
        bindCustomElementCompiled,
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
        prepareCustomElementCompiled,
        setIdentifier
      } = runtime;`
    )
    .replace('export const metadata =', 'const metadata =')
    .replace('export function mount', 'function mount');
  const factory = new Function('runtime', `${runnable}\nreturn { metadata, mount };`);

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
  const factory = new Function('runtime', 'ssr', `${runnable}\nreturn { metadata, render };`);

  return factory(runtime, ssr) as ExecutedSsrModule;
}

function executeHydrateModule(code: string): ExecutedHydrateModule {
  const runnable = code
    .replace(
      /import\s+\{[\s\S]*?\}\s+from '@lami\.js\/runtime\/internal';/,
      `const {
        addOptimizedEventListener,
        bindAttributeCompiled,
        bindClassCompiled,
        bindClassOptimizedCompiled,
        bindCustomElementCompiled,
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
        prepareCustomElementCompiled,
        setIdentifier
      } = runtime;`
    )
    .replace('export const metadata =', 'const metadata =')
    .replace('export function hydrate', 'function hydrate')
    .replace('export const mount = hydrate;', 'const mount = hydrate;');
  const factory = new Function('runtime', `${runnable}\nreturn { metadata, hydrate, mount };`);

  return factory(runtime) as ExecutedHydrateModule;
}
