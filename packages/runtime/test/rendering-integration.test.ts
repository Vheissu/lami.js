import { beforeEach, describe, expect, it } from 'vitest';
import { enhance } from '../src';

describe('runtime rendering integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('enhances real application HTML with forms, repeats, controllers, and events', async () => {
    document.body.innerHTML = `
      <main id="app">
        <h1>\${title}</h1>
        <form submit.trigger="add($event)">
          <input aria-label="New item" value.bind="newName">
          <button disabled.bind="!newName">Add</button>
        </form>
        <p if.bind="items.length">Showing \${items.length} items</p>
        <p else>No items</p>
        <ul>
          <li repeat.for="item of items; key: id" selected.class="item.id === selectedId">
            <label>
              <input type="radio" name="selected" model.bind="item.id" checked.bind="selectedId">
              \${$index + 1}. \${item.name}
            </label>
            <small if.bind="$last">last</small>
          </li>
        </ul>
        <button type="button" @click="selectFirst()">Select first</button>
        <strong>Selected: \${selectedName}</strong>
      </main>
    `;
    const model = {
      title: 'Lami Tasks',
      newName: '',
      nextId: 3,
      selectedId: 'b',
      items: [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' }
      ],
      get selectedName() {
        return this.items.find(item => item.id === this.selectedId)?.name ?? 'None';
      },
      add(event: SubmitEvent) {
        event.preventDefault();
        this.items.push({ id: String(this.nextId++), name: this.newName });
        this.newName = '';
      },
      selectFirst() {
        this.selectedId = this.items[0]?.id ?? '';
      }
    };
    const root = document.querySelector('#app')!;
    const handle = enhance(root, model);

    expect(renderedHtml(root)).toContain('<h1>Lami Tasks</h1>');
    expect(renderedHtml(root)).toContain('<p>Showing 2 items</p>');
    expect(itemText(root)).toEqual(['1. Alpha', '2. Beta last']);
    expect(root.querySelector('li:last-child')!.classList.contains('selected')).toBe(true);
    expect(root.querySelector('strong')!.textContent).toBe('Selected: Beta');
    expect(root.querySelector('button')!.hasAttribute('disabled')).toBe(true);

    const input = root.querySelector<HTMLInputElement>('input[aria-label="New item"]')!;
    input.value = 'Gamma';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await handle.flush();

    expect(root.querySelector('button')!.hasAttribute('disabled')).toBe(false);

    root.querySelector<HTMLButtonElement>('form button')!.click();
    await handle.flush();

    expect(input.value).toBe('');
    expect(root.querySelector('button')!.hasAttribute('disabled')).toBe(true);
    expect(renderedHtml(root)).toContain('<p>Showing 3 items</p>');
    expect(itemText(root)).toEqual(['1. Alpha', '2. Beta', '3. Gamma last']);

    const radios = root.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    radios[0]!.checked = true;
    radios[0]!.dispatchEvent(new Event('change', { bubbles: true }));
    await handle.flush();

    expect(root.querySelector('li:first-child')!.classList.contains('selected')).toBe(true);
    expect(root.querySelector('strong')!.textContent).toBe('Selected: Alpha');

    radios[1]!.checked = true;
    radios[1]!.dispatchEvent(new Event('change', { bubbles: true }));
    await handle.flush();
    expect(root.querySelector('strong')!.textContent).toBe('Selected: Beta');

    root.querySelector<HTMLButtonElement>('button[type="button"]')!.click();
    await handle.flush();

    expect(root.querySelector('strong')!.textContent).toBe('Selected: Alpha');
  });
});

function renderedHtml(element: Element): string {
  return element.innerHTML
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
}

function itemText(root: Element): string[] {
  return Array.from(root.querySelectorAll('li'), node => node.textContent?.trim().replace(/\s+/g, ' ') ?? '');
}
