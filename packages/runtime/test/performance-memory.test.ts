import { beforeEach, describe, expect, it } from 'vitest';
import { enhance, type Scope } from '../src';

describe('performance and cleanup smoke', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('enhances and updates a large keyed repeat with form bindings inside a smoke budget', async () => {
    const model = {
      items: Array.from({ length: 750 }, (_, index) => ({
        id: index + 1,
        name: `Item ${index + 1}`,
        done: index % 3 === 0
      }))
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

    const root = document.querySelector('#app')!;
    const { result: handle, duration: enhanceMs } = measure('enhance large repeat', () => enhance(root, model));

    expect(root.querySelectorAll('li')).toHaveLength(750);
    expect(root.querySelector('p')!.textContent).toBe('750 rows');

    const updateMs = await measureAsync('update large repeat', async () => {
      const context = handle.scope.bindingContext as typeof model;
      context.items = [
        { id: 10_001, name: 'Prepended', done: false },
        ...context.items.slice(0, 300),
        ...Array.from({ length: 200 }, (_, index) => ({
          id: 20_000 + index,
          name: `New ${index}`,
          done: index % 2 === 0
        }))
      ];
      await handle.flush();
    });

    expect(root.querySelectorAll('li')).toHaveLength(501);
    expect(root.querySelector('p')!.textContent).toBe('501 rows');
    expect(root.querySelector('li span')!.textContent).toBe('0: Prepended');
    expect(enhanceMs).toBeLessThan(2_500);
    expect(updateMs).toBeLessThan(2_500);
  }, 10_000);

  it('removes event listeners and effects for a broad disposed view', async () => {
    const model = {
      selected: 0,
      items: Array.from({ length: 250 }, (_, index) => ({ id: index + 1 })),
      select(item: { id: number }) {
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

    const root = document.querySelector('#app')!;
    const handle = enhance(root, model);
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));

    buttons[99]!.click();
    await handle.flush();
    expect(model.selected).toBe(100);
    expect(root.querySelector('p')!.textContent).toBe('100');

    const { duration: disposeMs } = measure('dispose broad view', () => handle.dispose());

    for (const button of buttons) button.click();
    model.selected = 999;
    await handle.flush();

    expect(model.selected).toBe(999);
    expect(root.isConnected).toBe(false);
    expect(disposeMs).toBeLessThan(1_000);
  }, 10_000);

  it('cleans up mutation-observed islands under repeated insert/remove churn', async () => {
    const islandModels: Array<{ count: number; increment(): void }> = [];
    document.body.innerHTML = `<main id="host"></main>`;
    const root = document.querySelector('#host')!;
    const handle = enhance(root, {}, {
      observeMutations: true,
      resources: {
        scopes: {
          counter(_parent: Scope) {
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

    const churnMs = await measureAsync('mutation island churn', async () => {
      root.append(...islands);
      await mutationTick();
      await handle.flush();

      for (const island of islands) {
        island.querySelector<HTMLButtonElement>('button')!.click();
      }
      await handle.flush();

      for (const island of islands) island.remove();
      await mutationTick();
    });

    expect(islandModels).toHaveLength(40);
    expect(islandModels.every(model => model.count === 1)).toBe(true);

    for (const island of islands) {
      island.querySelector<HTMLButtonElement>('button')!.click();
    }
    await handle.flush();

    expect(islandModels.every(model => model.count === 1)).toBe(true);
    expect(churnMs).toBeLessThan(1_500);
  }, 10_000);
});

function measure<T>(label: string, callback: () => T): { result: T; duration: number } {
  const start = performance.now();
  const result = callback();
  const duration = performance.now() - start;
  recordMeasure(label, duration);
  return { result, duration };
}

async function measureAsync(label: string, callback: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await callback();
  const duration = performance.now() - start;
  recordMeasure(label, duration);
  return duration;
}

function recordMeasure(label: string, duration: number): void {
  expect(Number.isFinite(duration), `${label} produced a finite duration`).toBe(true);
}

async function mutationTick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
