import { writeFile, mkdir } from 'node:fs/promises';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';
import { enhance } from '../packages/runtime/dist/index.js';
import { compileTemplate } from '../packages/compiler/dist/index.js';
import * as runtime from '../packages/runtime/dist/internal.js';
import { defineElement } from '../packages/runtime/dist/index.js';

process.env.NODE_ENV = 'production';

const require = createRequire(import.meta.url);
const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { flushSync } = await import('react-dom');
const reactVersion = React.version;
const sveltePackage = require('svelte/package.json');

const outputDir = new URL('../docs/assets/', import.meta.url);
const jsonOutput = new URL('performance-report.json', outputDir);
const markdownOutput = new URL('performance-report.md', outputDir);
const svgOutput = new URL('performance-report.svg', outputDir);

installDom();

const { compile: compileSvelte } = await import('svelte/compiler');
const svelteInternal = await import('svelte/internal/client');
const svelteRoot = dirname(require.resolve('svelte/package.json'));
const {
  mount: svelteMount,
  unmount: svelteUnmount,
  flushSync: svelteFlushSync
} = await import(pathToFileURL(join(svelteRoot, 'src/index-client.js')).href);

const largeInitialItems = Array.from({ length: 750 }, (_, index) => ({
  id: index + 1,
  name: `Item ${index + 1}`,
  done: index % 3 === 0
}));

const updatedItems = [
  { id: 10_001, name: 'Prepended', done: false },
  ...largeInitialItems.slice(0, 300),
  ...Array.from({ length: 200 }, (_, index) => ({
    id: 20_000 + index,
    name: `New ${index}`,
    done: index % 2 === 0
  }))
];

const showInitialItems = Array.from({ length: 600 }, (_, index) => ({
  id: index + 1,
  name: `Panel ${index + 1}`,
  visible: index % 2 === 0
}));

const showUpdatedItems = showInitialItems.map(item => ({
  ...item,
  visible: !item.visible
}));

const compiledRowsModule = executeDomModule(compileTemplate(`
  <main>
    <p>\${items.length} rows</p>
    <ul>
      <li repeat.for="item of items; key: id" done.class="item.done">
        <label>
          <input type="checkbox" checked.bind="item.done">
          <span>\${$index}: \${item.name}</span>
        </label>
      </li>
    </ul>
  </main>
`, { mode: 'dom' }).code);

const compiledListenersModule = executeDomModule(compileTemplate(`
  <section>
    <p>\${selected}</p>
    <button repeat.for="item of items; key: id" selected.class="selected === item.id" @click="select(item)">
      \${item.id}
    </button>
  </section>
`, { mode: 'dom' }).code);

const compiledShowRowsModule = executeDomModule(compileTemplate(`
  <ul>
    <li repeat.for="item of items; key: id">
      <span show.bind="item.visible">\${item.name}</span>
    </li>
  </ul>
`, { mode: 'dom' }).code);

class BenchCard {
  item = { id: 0, name: '', done: false };
}

class BenchRichCard {
  item = { id: 0, name: '', done: false };

  toggle() {
    this.item.done = !this.item.done;
  }
}

defineElement('bench-card', {
  name: 'bench-card',
  Type: BenchCard,
  bindables: {
    item: {}
  },
  template: `
    <article done.class="item.done">
      <header>\${item.name}<slot name="action"></slot></header>
      <section><slot></slot></section>
    </article>
  `
});

defineElement('bench-rich-card', {
  name: 'bench-rich-card',
  Type: BenchRichCard,
  bindables: {
    item: {}
  },
  template: `
    <article done.class="item.done" title.bind="'Card ' + item.name" style.border-color.bind="item.done ? 'green' : 'gray'">
      <header>\${item.name}<slot name="action"></slot></header>
      <small show.bind="item.done" data-item="\${item.name}">done</small>
      <button @click="toggle()">toggle</button>
      <section><slot></slot></section>
    </article>
  `
});

const compiledComponentModule = executeDomModule(compileTemplate(`
  <main>
    <bench-card repeat.for="item of items; key: id" item.bind="item">
      <button slot="action" @click="select()">\${count}</button>
      <p>\${item.name}</p>
    </bench-card>
  </main>
`, { mode: 'dom' }).code);

const compiledRichComponentModule = executeDomModule(compileTemplate(`
  <main>
    <bench-rich-card repeat.for="item of items; key: id" item.bind="item">
      <button slot="action" @click="select()">\${count}</button>
      <p>\${item.name}</p>
    </bench-rich-card>
  </main>
`, { mode: 'dom' }).code);

const SvelteRows = compileSvelteComponent(`
  <script>
    let { initialItems } = $props();
    let items = $state(initialItems);
    export function setItems(next) {
      items = next;
    }
  </script>
  <p>{items.length} rows</p>
  <ul>
    {#each items as item, index (item.id)}
      <li class:done={item.done}>
        <label>
          <input type="checkbox" checked={item.done} onchange={() => {}}>
          <span>{index}: {item.name}</span>
        </label>
      </li>
    {/each}
  </ul>
`, 'SvelteRows');

const SvelteListeners = compileSvelteComponent(`
  <script>
    let { onSelect } = $props();
    const items = Array.from({ length: 250 }, (_, index) => index + 1);
  </script>
  <p>0</p>
  {#each items as id (id)}
    <button onclick={() => onSelect(id)}>{id}</button>
  {/each}
`, 'SvelteListeners');

const comparisonScenarios = [
  {
    id: 'large-repeat-enhance',
    label: 'Render 750 rows',
    description: 'Initial render of 750 keyed rows with checkbox state and text output.',
    iterations: 7,
    runs: {
      'Lami.js': lamiRenderRows,
      'Lami compiled': lamiCompiledRenderRows,
      'Vanilla DOM': vanillaRenderRows,
      'React 19': reactRenderRows,
      'Svelte 5': svelteRenderRows
    }
  },
  {
    id: 'keyed-repeat-update',
    label: 'Update to 501 rows',
    description: 'Prepend one row, retain 300 existing rows, and append 200 new rows.',
    iterations: 7,
    runs: {
      'Lami.js': lamiUpdateRows,
      'Lami compiled': lamiCompiledUpdateRows,
      'Vanilla DOM': vanillaUpdateRows,
      'React 19': reactUpdateRows,
      'Svelte 5': svelteUpdateRows
    }
  },
  {
    id: 'broad-dispose',
    label: 'Dispose 250 listeners',
    description: 'Create 250 clickable rows, dispose them, then verify old listeners no longer fire.',
    iterations: 9,
    runs: {
      'Lami.js': lamiDisposeListeners,
      'Lami compiled': lamiCompiledDisposeListeners,
      'Vanilla DOM': vanillaDisposeListeners,
      'React 19': reactDisposeListeners,
      'Svelte 5': svelteDisposeListeners
    }
  }
];

const lamiOnlyScenarios = [
  {
    id: 'mutation-island-churn',
    label: 'Lami island churn',
    description: 'Mutation-observed enhancement and cleanup for 40 scoped islands.',
    iterations: 7,
    runs: {
      'Lami.js': lamiMutationIslandChurn
    }
  },
  {
    id: 'compiled-show-row-refresh',
    label: 'Compiled show row refresh',
    description: 'Toggle 600 compiled repeat-row show bindings without leaving the optimized row path.',
    iterations: 7,
    runs: {
      'Lami compiled': lamiCompiledShowRowRefresh
    }
  },
  {
    id: 'component-slot-mount',
    label: 'Component slot mount',
    description: 'Render 120 lightweight elements with bindable props, named slots, and projected parent-scope content.',
    iterations: 7,
    runs: {
      'Lami.js': lamiComponentSlotMount,
      'Lami compiled': lamiCompiledComponentSlotMount
    }
  },
  {
    id: 'rich-component-slot-mount',
    label: 'Rich component slot mount',
    description: 'Render 120 lightweight elements whose internal template uses text, class, property, style, show, attribute interpolation, events, and slots.',
    iterations: 7,
    runs: {
      'Lami.js': lamiRichComponentSlotMount,
      'Lami compiled': lamiCompiledRichComponentSlotMount
    }
  }
];

const generatedAt = new Date();
const comparisonResults = [];
const lamiOnlyResults = [];

for (const scenario of comparisonScenarios) {
  comparisonResults.push(await measureScenario(scenario));
}

for (const scenario of lamiOnlyScenarios) {
  lamiOnlyResults.push(await measureScenario(scenario));
}

await mkdir(outputDir, { recursive: true });

const report = {
  generatedAt: generatedAt.toISOString(),
  environment: {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    jsdom: '26.1.0',
    react: reactVersion,
    svelte: sveltePackage.version
  },
  comparisonScenarios: comparisonResults,
  lamiOnlyScenarios: lamiOnlyResults
};

await writeFile(jsonOutput, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(markdownOutput, renderMarkdown(report));
await writeFile(svgOutput, renderSvg(report));

console.log('Lami.js performance report');
for (const scenario of comparisonResults) {
  console.log(`- ${scenario.label}`);
  for (const result of scenario.results) {
    console.log(`  ${result.engine}: median ${formatMs(result.medianMs)} ms, min ${formatMs(result.minMs)} ms, p95 ${formatMs(result.p95Ms)} ms`);
  }
}
for (const scenario of lamiOnlyResults) {
  console.log(`- ${scenario.label}`);
  for (const result of scenario.results) {
    console.log(`  ${result.engine}: median ${formatMs(result.medianMs)} ms, min ${formatMs(result.minMs)} ms, p95 ${formatMs(result.p95Ms)} ms`);
  }
}
console.log(`Wrote ${filePath(markdownOutput)}`);
console.log(`Wrote ${filePath(jsonOutput)}`);
console.log(`Wrote ${filePath(svgOutput)}`);

function lamiRenderRows() {
  const model = {
    items: cloneItems(largeInitialItems)
  };
  document.body.innerHTML = `
    <main id="app">
      <p>\${items.length} rows</p>
      <ul>
        <li repeat.for="item of items; key: id" done.class="item.done">
          <label>
            <input type="checkbox" checked.bind="item.done">
            <span>\${$index}: \${item.name}</span>
          </label>
        </li>
      </ul>
    </main>
  `;

  const root = document.querySelector('#app');
  const handle = enhance(root, model);
  assert(root.querySelectorAll('li').length === 750, 'Lami did not render 750 rows');
  handle.dispose();
}

async function lamiUpdateRows() {
  const model = {
    items: cloneItems(largeInitialItems)
  };
  document.body.innerHTML = `
    <main id="app">
      <p>\${items.length} rows</p>
      <ul>
        <li repeat.for="item of items; key: id" done.class="item.done">
          <input type="checkbox" checked.bind="item.done">
          <span>\${$index}: \${item.name}</span>
        </li>
      </ul>
    </main>
  `;

  const root = document.querySelector('#app');
  const handle = enhance(root, model);
  const context = handle.scope.bindingContext;
  context.items = cloneItems(updatedItems);
  await handle.flush();
  assert(root.querySelectorAll('li').length === 501, 'Lami did not update to 501 rows');
  assert(root.querySelector('p').textContent === '501 rows', 'Lami did not refresh count text');
  handle.dispose();
}

function lamiDisposeListeners() {
  const model = {
    selected: 0,
    items: Array.from({ length: 250 }, (_, index) => ({ id: index + 1 })),
    select(item) {
      this.selected = item.id;
    }
  };
  document.body.innerHTML = `
    <section id="app">
      <p>\${selected}</p>
      <button repeat.for="item of items; key: id" selected.class="selected === item.id" @click="select(item)">
        \${item.id}
      </button>
    </section>
  `;

  const root = document.querySelector('#app');
  const handle = enhance(root, model);
  const buttons = Array.from(root.querySelectorAll('button'));
  handle.dispose();
  for (const button of buttons) {
    button.click();
  }
  assert(model.selected === 0, 'Lami disposed listeners still fired');
}

function lamiCompiledRenderRows() {
  const model = {
    items: cloneItems(largeInitialItems)
  };
  const target = document.createElement('div');
  document.body.append(target);
  const app = compiledRowsModule.mount(target, model);
  assert(target.querySelectorAll('li').length === 750, 'compiled Lami did not render 750 rows');
  app.dispose();
  target.remove();
}

async function lamiCompiledUpdateRows() {
  const model = {
    items: cloneItems(largeInitialItems)
  };
  const target = document.createElement('div');
  document.body.append(target);
  const app = compiledRowsModule.mount(target, model);
  app.scope.bindingContext.items = cloneItems(updatedItems);
  await app.flush();
  assert(target.querySelectorAll('li').length === 501, 'compiled Lami did not update to 501 rows');
  assert(target.querySelector('p').textContent === '501 rows', 'compiled Lami did not refresh count text');
  app.dispose();
  target.remove();
}

function lamiCompiledDisposeListeners() {
  const model = {
    selected: 0,
    items: Array.from({ length: 250 }, (_, index) => ({ id: index + 1 })),
    select(item) {
      this.selected = item.id;
    }
  };
  const target = document.createElement('div');
  document.body.append(target);
  const app = compiledListenersModule.mount(target, model);
  const buttons = Array.from(target.querySelectorAll('button'));
  app.dispose();
  target.remove();
  for (const button of buttons) {
    button.click();
  }
  assert(model.selected === 0, 'compiled Lami disposed listeners still fired');
}

async function lamiCompiledShowRowRefresh() {
  const model = {
    items: cloneItems(showInitialItems)
  };
  const target = document.createElement('div');
  document.body.append(target);
  const app = compiledShowRowsModule.mount(target, model);
  app.scope.bindingContext.items = cloneItems(showUpdatedItems);
  await app.flush();
  const visible = Array.from(target.querySelectorAll('span'))
    .filter(span => span.style.display !== 'none')
    .length;
  assert(visible === 300, 'compiled Lami did not refresh show rows');
  app.dispose();
  target.remove();
}

async function lamiMutationIslandChurn() {
  const islandModels = [];
  document.body.innerHTML = `<main id="host"></main>`;
  const root = document.querySelector('#host');
  const handle = enhance(root, {}, {
    observeMutations: true,
    resources: {
      scopes: {
        counter() {
          const model = {
            count: 0,
            increment() {
              this.count++;
            }
          };
          islandModels.push(model);
          return model;
        }
      }
    }
  });

  const islands = Array.from({ length: 40 }, (_, index) => {
    const island = document.createElement('section');
    island.setAttribute('data-lami-scope', 'counter');
    island.innerHTML = `<button @click="increment()">\${count}:${index}</button>`;
    return island;
  });

  root.append(...islands);
  await mutationTick();
  await handle.flush();
  for (const island of islands) {
    island.querySelector('button').click();
  }
  await handle.flush();
  for (const island of islands) island.remove();
  await mutationTick();
  assert(islandModels.every(model => model.count === 1), 'Lami mutation islands did not update exactly once');
  handle.dispose();
}

function lamiComponentSlotMount() {
  const model = {
    items: largeInitialItems.slice(0, 120).map(item => ({ ...item })),
    count: 0,
    select() {
      this.count++;
    }
  };
  document.body.innerHTML = `
    <main id="app">
      <bench-card repeat.for="item of items; key: id" item.bind="item">
        <button slot="action" @click="select()">\${count}</button>
        <p>\${item.name}</p>
      </bench-card>
    </main>
  `;

  const root = document.querySelector('#app');
  const handle = enhance(root, model);
  assert(root.querySelectorAll('article').length === 120, 'Lami did not render component slots');
  assert(root.querySelector('button').textContent === '0', 'Lami did not bind projected slot content');
  handle.dispose();
}

function lamiCompiledComponentSlotMount() {
  const model = {
    items: largeInitialItems.slice(0, 120).map(item => ({ ...item })),
    count: 0,
    select() {
      this.count++;
    }
  };
  const target = document.createElement('div');
  document.body.append(target);
  const app = compiledComponentModule.mount(target, model);
  assert(target.querySelectorAll('article').length === 120, 'compiled Lami did not render component slots');
  assert(target.querySelector('button').textContent === '0', 'compiled Lami did not bind projected slot content');
  app.dispose();
  target.remove();
}

function lamiRichComponentSlotMount() {
  const model = {
    items: largeInitialItems.slice(0, 120).map(item => ({ ...item })),
    count: 0,
    select() {
      this.count++;
    }
  };
  document.body.innerHTML = `
    <main id="app">
      <bench-rich-card repeat.for="item of items; key: id" item.bind="item">
        <button slot="action" @click="select()">\${count}</button>
        <p>\${item.name}</p>
      </bench-rich-card>
    </main>
  `;

  const root = document.querySelector('#app');
  const handle = enhance(root, model);
  assert(root.querySelectorAll('article').length === 120, 'Lami did not render rich component slots');
  assert(root.querySelector('button').textContent === '0', 'Lami did not bind rich projected slot content');
  assert(root.querySelector('article').title === 'Card Item 1', 'Lami did not bind rich component properties');
  handle.dispose();
}

function lamiCompiledRichComponentSlotMount() {
  const model = {
    items: largeInitialItems.slice(0, 120).map(item => ({ ...item })),
    count: 0,
    select() {
      this.count++;
    }
  };
  const target = document.createElement('div');
  document.body.append(target);
  const app = compiledRichComponentModule.mount(target, model);
  assert(target.querySelectorAll('article').length === 120, 'compiled Lami did not render rich component slots');
  assert(target.querySelector('button').textContent === '0', 'compiled Lami did not bind rich projected slot content');
  assert(target.querySelector('article').title === 'Card Item 1', 'compiled Lami did not bind rich component properties');
  app.dispose();
  target.remove();
}

function vanillaRenderRows() {
  const root = document.createElement('main');
  root.id = 'app';
  renderVanillaRows(root, cloneItems(largeInitialItems));
  document.body.append(root);
  assert(root.querySelectorAll('li').length === 750, 'vanilla DOM did not render 750 rows');
  root.remove();
}

function vanillaUpdateRows() {
  const root = document.createElement('main');
  root.id = 'app';
  renderVanillaRows(root, cloneItems(largeInitialItems));
  document.body.append(root);
  renderVanillaRows(root, cloneItems(updatedItems));
  assert(root.querySelectorAll('li').length === 501, 'vanilla DOM did not update to 501 rows');
  assert(root.querySelector('p').textContent === '501 rows', 'vanilla DOM did not refresh count text');
  root.remove();
}

function vanillaDisposeListeners() {
  let selected = 0;
  const abort = new AbortController();
  const root = document.createElement('section');
  root.id = 'app';
  const count = document.createElement('p');
  count.textContent = '0';
  root.append(count);

  const buttons = [];
  for (let index = 1; index <= 250; index++) {
    const button = document.createElement('button');
    button.textContent = String(index);
    button.addEventListener('click', () => {
      selected = index;
      count.textContent = String(index);
    }, { signal: abort.signal });
    buttons.push(button);
    root.append(button);
  }

  document.body.append(root);
  abort.abort();
  root.remove();
  for (const button of buttons) {
    button.click();
  }
  assert(selected === 0, 'vanilla DOM disposed listeners still fired');
}

function renderVanillaRows(root, items) {
  root.textContent = '';
  const count = document.createElement('p');
  count.textContent = `${items.length} rows`;
  const list = document.createElement('ul');
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const row = document.createElement('li');
    if (item.done) row.classList.add('done');
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.done;
    checkbox.addEventListener('change', () => {
      item.done = checkbox.checked;
      row.classList.toggle('done', item.done);
    });
    const text = document.createElement('span');
    text.textContent = `${index}: ${item.name}`;
    label.append(checkbox, text);
    row.append(label);
    fragment.append(row);
  }

  list.append(fragment);
  root.append(count, list);
}

function reactRenderRows() {
  const host = document.createElement('main');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => {
    root.render(React.createElement(ReactRows, { items: cloneItems(largeInitialItems) }));
  });
  assert(host.querySelectorAll('li').length === 750, 'React did not render 750 rows');
  flushSync(() => root.unmount());
  host.remove();
}

function reactUpdateRows() {
  const host = document.createElement('main');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => {
    root.render(React.createElement(ReactRows, { items: cloneItems(largeInitialItems) }));
  });
  flushSync(() => {
    root.render(React.createElement(ReactRows, { items: cloneItems(updatedItems) }));
  });
  assert(host.querySelectorAll('li').length === 501, 'React did not update to 501 rows');
  assert(host.querySelector('p').textContent === '501 rows', 'React did not refresh count text');
  flushSync(() => root.unmount());
  host.remove();
}

function reactDisposeListeners() {
  let selected = 0;
  const host = document.createElement('section');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => {
    root.render(React.createElement(ReactListeners, {
      onSelect(id) {
        selected = id;
      }
    }));
  });
  const buttons = Array.from(host.querySelectorAll('button'));
  flushSync(() => root.unmount());
  host.remove();
  for (const button of buttons) {
    button.click();
  }
  assert(selected === 0, 'React disposed listeners still fired');
}

function svelteRenderRows() {
  const host = document.createElement('main');
  document.body.append(host);
  const app = svelteMount(SvelteRows, {
    target: host,
    props: { initialItems: cloneItems(largeInitialItems) }
  });
  assert(host.querySelectorAll('li').length === 750, 'Svelte did not render 750 rows');
  svelteUnmount(app);
  host.remove();
}

function svelteUpdateRows() {
  const host = document.createElement('main');
  document.body.append(host);
  const app = svelteMount(SvelteRows, {
    target: host,
    props: { initialItems: cloneItems(largeInitialItems) }
  });
  svelteFlushSync(() => {
    app.setItems(cloneItems(updatedItems));
  });
  assert(host.querySelectorAll('li').length === 501, 'Svelte did not update to 501 rows');
  assert(host.querySelector('p').textContent === '501 rows', 'Svelte did not refresh count text');
  svelteUnmount(app);
  host.remove();
}

function svelteDisposeListeners() {
  let selected = 0;
  const host = document.createElement('section');
  document.body.append(host);
  const app = svelteMount(SvelteListeners, {
    target: host,
    props: {
      onSelect(id) {
        selected = id;
      }
    }
  });
  const buttons = Array.from(host.querySelectorAll('button'));
  svelteUnmount(app);
  host.remove();
  for (const button of buttons) {
    button.click();
  }
  assert(selected === 0, 'Svelte disposed listeners still fired');
}

function ReactRows({ items }) {
  return React.createElement(React.Fragment, null,
    React.createElement('p', null, `${items.length} rows`),
    React.createElement('ul', null, items.map((item, index) => (
      React.createElement('li', {
        key: item.id,
        className: item.done ? 'done' : ''
      },
        React.createElement('label', null,
          React.createElement('input', {
            type: 'checkbox',
            checked: item.done,
            onChange() {}
          }),
          React.createElement('span', null, `${index}: ${item.name}`)
        )
      )
    )))
  );
}

function ReactListeners({ onSelect }) {
  return React.createElement(React.Fragment, null,
    React.createElement('p', null, '0'),
    Array.from({ length: 250 }, (_, index) => {
      const id = index + 1;
      return React.createElement('button', {
        key: id,
        onClick: () => onSelect(id)
      }, String(id));
    })
  );
}

async function measureScenario(scenario) {
  const results = [];

  for (const [engine, run] of Object.entries(scenario.runs)) {
    results.push(await measureRun(engine, run, scenario.iterations));
  }

  return {
    id: scenario.id,
    label: scenario.label,
    description: scenario.description,
    iterations: scenario.iterations,
    results
  };
}

async function measureRun(engine, run, iterations) {
  const durations = [];
  const heapDeltas = [];

  await runMeasuredOnce(run);

  for (let index = 0; index < iterations; index++) {
    document.body.innerHTML = '';
    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();
    await runMeasuredOnce(run);
    const duration = performance.now() - start;
    const heapAfter = process.memoryUsage().heapUsed;
    durations.push(duration);
    heapDeltas.push(heapAfter - heapBefore);
  }

  durations.sort((left, right) => left - right);
  heapDeltas.sort((left, right) => left - right);

  return {
    engine,
    medianMs: percentile(durations, 50),
    minMs: durations[0],
    p95Ms: percentile(durations, 95),
    maxMs: durations.at(-1),
    medianHeapKb: percentile(heapDeltas, 50) / 1024
  };
}

async function runMeasuredOnce(run) {
  const result = run();
  if (result && typeof result.then === 'function') {
    await result;
  }
}

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/'
  });

  const globals = [
    'window',
    'document',
    'Node',
    'Element',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLOptionElement',
    'HTMLTextAreaElement',
    'HTMLTemplateElement',
    'DocumentFragment',
    'Text',
    'Comment',
    'MutationObserver',
    'Event',
    'MouseEvent',
    'InputEvent',
    'SubmitEvent',
    'FocusEvent',
    'KeyboardEvent',
    'CustomEvent',
    'AbortController',
    'AbortSignal',
    'customElements'
  ];

  for (const key of globals) {
    globalThis[key] = dom.window[key];
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true
  });
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.ceil((percentileValue / 100) * values.length) - 1);
  return values[index];
}

function renderMarkdown(report) {
  const rows = report.comparisonScenarios.flatMap(scenario => (
    scenario.results.map(result => (
      `| ${scenario.label} | ${result.engine} | ${scenario.iterations} | ${formatMs(result.medianMs)} ms | ${formatMs(result.minMs)} ms | ${formatMs(result.p95Ms)} ms | ${formatKb(result.medianHeapKb)} KB |`
    ))
  )).join('\n');
  const lamiRows = report.lamiOnlyScenarios.flatMap(scenario => (
    scenario.results.map(result => (
      `| ${scenario.label} | ${result.engine} | ${scenario.iterations} | ${formatMs(result.medianMs)} ms | ${formatMs(result.minMs)} ms | ${formatMs(result.p95Ms)} ms | ${formatKb(result.medianHeapKb)} KB |`
    ))
  )).join('\n');

  return `# Lami.js Performance Report

Generated at ${report.generatedAt} on ${report.environment.node} (${report.environment.platform}).

Runtime versions: jsdom ${report.environment.jsdom}, React ${report.environment.react}, Svelte ${report.environment.svelte}.

These numbers are local smoke benchmarks. They are intended to catch regressions
and provide a concrete performance story for Lami.js scenarios; they are not a
formal cross-framework benchmark.

![Performance report](./performance-report.svg)

## Comparison Scenarios

| Scenario | Engine | Runs | Median | Min | p95 | Median heap delta |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
${rows}

## Lami-Specific Scenario

| Scenario | Engine | Runs | Median | Min | p95 | Median heap delta |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
${lamiRows}
`;
}

function renderSvg(report) {
  const width = 1160;
  const scenarioHeight = 210;
  const lamiOnlyHeight = 70 + report.lamiOnlyScenarios.reduce((total, scenario) => total + 78 + scenario.results.length * 34, 0);
  const height = 190 + report.comparisonScenarios.length * scenarioHeight + lamiOnlyHeight;
  const left = 300;
  const chartWidth = 620;
  const allResults = report.comparisonScenarios.flatMap(scenario => scenario.results);
  const allP95Values = [
    ...allResults.map(result => result.p95Ms),
    ...report.lamiOnlyScenarios.flatMap(scenario => scenario.results.map(result => result.p95Ms))
  ];
  const max = d3.max(allP95Values) ?? 1;
  const xScale = d3.scaleLinear()
    .domain([0, max])
    .nice()
    .range([0, chartWidth]);
  const ticks = xScale.ticks(5);
  const engineClass = {
    'Lami.js': 'lami',
    'Lami compiled': 'compiled',
    'Vanilla DOM': 'vanilla',
    'React 19': 'react',
    'Svelte 5': 'svelte'
  };
  const tickLines = ticks.map(tick => {
    const x = left + xScale(tick);
    return `
  <line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="118" y2="${height - 70}" class="grid" />
  <text x="${x.toFixed(1)}" y="${height - 50}" class="tick">${formatTick(tick)} ms</text>`;
  }).join('');

  const scenarios = report.comparisonScenarios.map((scenario, scenarioIndex) => {
    const y = 132 + scenarioIndex * scenarioHeight;
    const bars = scenario.results.map((result, resultIndex) => {
      const barY = y + 42 + resultIndex * 34;
      const medianWidth = Math.max(2, xScale(result.medianMs));
      const p95Width = Math.max(2, xScale(result.p95Ms));
      return `
  <text x="72" y="${barY + 17}" class="engine">${escapeXml(result.engine)}</text>
  <rect x="${left}" y="${barY}" width="${p95Width.toFixed(1)}" height="20" rx="4" class="p95 ${engineClass[result.engine] ?? 'other'}" />
  <rect x="${left}" y="${barY + 5}" width="${medianWidth.toFixed(1)}" height="10" rx="3" class="median ${engineClass[result.engine] ?? 'other'}" />
  <text x="${left + p95Width + 14}" y="${barY + 15}" class="value">${formatMs(result.medianMs)} ms median / ${formatMs(result.p95Ms)} ms p95</text>`;
    }).join('');

    return `
  <text x="48" y="${y}" class="scenario">${escapeXml(scenario.label)}</text>
  <text x="48" y="${y + 24}" class="description">${escapeXml(scenario.description)}</text>
${bars}`;
  }).join('');

  let lamiOnlyOffset = 0;
  const lamiOnly = report.lamiOnlyScenarios.map(scenario => {
    const y = 132 + report.comparisonScenarios.length * scenarioHeight + 18 + lamiOnlyOffset;
    const bars = scenario.results.map((result, resultIndex) => {
      const barY = y + 51 + resultIndex * 34;
      const p95Width = Math.max(2, xScale(result.p95Ms));
      const medianWidth = Math.max(2, xScale(result.medianMs));
      const className = engineClass[result.engine] ?? 'lami';
      return `
  <text x="72" y="${barY + 17}" class="engine">${escapeXml(result.engine)}</text>
  <rect x="${left}" y="${barY}" width="${p95Width.toFixed(1)}" height="20" rx="4" class="p95 ${className}" />
  <rect x="${left}" y="${barY + 5}" width="${medianWidth.toFixed(1)}" height="10" rx="3" class="median ${className}" />
  <text x="${left + p95Width + 14}" y="${barY + 15}" class="value">${formatMs(result.medianMs)} ms median / ${formatMs(result.p95Ms)} ms p95</text>`;
    }).join('');
    lamiOnlyOffset += 78 + scenario.results.length * 34;
    return `
  <text x="48" y="${y}" class="scenario">${escapeXml(scenario.label)}</text>
  <text x="48" y="${y + 24}" class="description">${escapeXml(scenario.description)}</text>
${bars}`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Lami.js performance comparison</title>
  <desc id="desc">Median and p95 timings for Lami.js, vanilla DOM, React 19, and Svelte 5 scenarios.</desc>
  <style>
    .bg { fill: #fbfaf5; }
    .title { fill: #211f1a; font: 700 36px Georgia, serif; }
    .meta, .description { fill: #6c665b; font: 14px ui-sans-serif, system-ui, sans-serif; }
    .scenario { fill: #211f1a; font: 700 21px ui-sans-serif, system-ui, sans-serif; }
    .engine { fill: #211f1a; font: 600 16px ui-sans-serif, system-ui, sans-serif; }
    .value { fill: #211f1a; font: 600 14px ui-sans-serif, system-ui, sans-serif; }
    .axis { stroke: #d8d1c3; stroke-width: 1; }
    .grid { stroke: #ded7c9; stroke-width: 1; stroke-dasharray: 3 5; }
    .tick { fill: #6c665b; font: 12px ui-sans-serif, system-ui, sans-serif; text-anchor: middle; }
    .p95 { opacity: 0.35; }
    .median { opacity: 1; }
    .lami { fill: #2f6f63; }
    .compiled { fill: #5f7741; }
    .vanilla { fill: #b68a2d; }
    .react { fill: #784f3f; }
    .svelte { fill: #b64b34; }
    .note { fill: #4b473f; font: 600 15px ui-sans-serif, system-ui, sans-serif; }
  </style>
  <rect class="bg" width="100%" height="100%" />
  <text x="48" y="58" class="title">Lami.js Performance Comparison</text>
  <text x="48" y="88" class="meta">Generated ${escapeXml(report.generatedAt)} on ${escapeXml(report.environment.node)} with React ${escapeXml(report.environment.react)}, Svelte ${escapeXml(report.environment.svelte)}, and jsdom ${escapeXml(report.environment.jsdom)}</text>
  <line x1="${left}" x2="${left + chartWidth}" y1="112" y2="112" class="axis" />
${tickLines}
  <text x="${left}" y="103" class="meta">shorter is faster; solid bar = median, pale bar = p95</text>
${scenarios}
${lamiOnly}
  <text x="48" y="${height - 32}" class="note">Local smoke benchmark; exact numbers vary by hardware and runtime.</text>
</svg>
`;
}

function cloneItems(items) {
  return items.map(item => ({ ...item }));
}

function executeDomModule(code) {
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
  const factory = new Function('runtime', `${runnable}\nreturn { mount };`);

  return factory(runtime);
}

function compileSvelteComponent(source, name) {
  const { js } = compileSvelte(source, {
    generate: 'client',
    dev: false,
    name
  });
  const runnable = js.code
    .replace("import 'svelte/internal/disclose-version';", '')
    .replace("import * as $ from 'svelte/internal/client';", 'const $ = svelteInternal;')
    .replace(`export default function ${name}`, `function ${name}`);
  const factory = new Function('svelteInternal', `${runnable}\nreturn ${name};`);

  return factory(svelteInternal);
}

function formatMs(value) {
  return value.toFixed(value >= 100 ? 1 : 2);
}

function formatKb(value) {
  return value.toFixed(1);
}

function formatTick(value) {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function filePath(url) {
  return url.pathname;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function mutationTick() {
  await Promise.resolve();
  await Promise.resolve();
}
