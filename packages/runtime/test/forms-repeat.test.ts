import { beforeEach, describe, expect, it } from 'vitest';
import { enhance } from '../src';
import { LamiError } from '../src/util/errors';

describe('forms', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('updates text inputs only from updateTrigger events when configured', async () => {
    document.body.innerHTML = `
      <section id="app">
        <input value.bind="name & updateTrigger:'blur'">
        <p>\${name}</p>
      </section>
    `;

    const root = document.querySelector('#app')!;
    const handle = enhance(root, { name: 'Lami' });
    const input = root.querySelector('input')!;

    input.value = 'Lami.js';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await handle.flush();
    expect(root.querySelector('p')!.textContent).toBe('Lami');

    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await handle.flush();
    expect(root.querySelector('p')!.textContent).toBe('Lami.js');
  });

  it('binds boolean checkboxes in both directions', async () => {
    document.body.innerHTML = `
      <section id="app">
        <input type="checkbox" checked.bind="accepted">
        <p>\${accepted ? 'yes' : 'no'}</p>
      </section>
    `;

    const root = document.querySelector('#app')!;
    const handle = enhance(root, { accepted: false });
    const checkbox = root.querySelector('input')!;

    expect(checkbox.checked).toBe(false);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await handle.flush();

    expect(root.querySelector('p')!.textContent).toBe('yes');
  });

  it('binds native normalized input values in both directions', async () => {
    document.body.innerHTML = `
      <section id="app">
        <input type="number" value-as-number.bind="quantity">
        <p>\${quantity}</p>
      </section>
    `;

    const root = document.querySelector('#app')!;
    const handle = enhance(root, { quantity: 3 });
    const input = root.querySelector('input')!;

    expect(input.valueAsNumber).toBe(3);

    input.value = '8';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await handle.flush();

    expect((handle.scope.bindingContext as { quantity: number }).quantity).toBe(8);
    expect(root.querySelector('p')!.textContent).toBe('8');

    (handle.scope.bindingContext as { quantity: number }).quantity = 13;
    await handle.flush();

    expect(input.valueAsNumber).toBe(13);
  });

  it('writes a reset value back to an input after same-tick form submission', async () => {
    document.body.innerHTML = `
      <form id="app" submit.trigger="submit($event)">
        <input value.bind="title">
        <p>\${title}</p>
      </form>
    `;

    const root = document.querySelector('#app')!;
    const handle = enhance(root, {
      title: '',
      submit(event: SubmitEvent) {
        event.preventDefault();
        this.title = '';
      }
    });
    const input = root.querySelector('input')!;

    input.value = 'Draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    root.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await handle.flush();

    expect(input.value).toBe('');
    expect(root.querySelector('p')!.textContent).toBe('');
  });

  it('binds radio groups using model.bind', async () => {
    const basic = { id: 'basic', name: 'Basic' };
    const pro = { id: 'pro', name: 'Pro' };

    document.body.innerHTML = `
      <form id="plans">
        <label repeat.for="plan of plans">
          <input type="radio" name="plan" model.bind="plan" checked.bind="selectedPlan">
          \${plan.name}
        </label>
        <p>\${selectedPlan.name}</p>
      </form>
    `;

    const root = document.querySelector('#plans')!;
    const handle = enhance(root, { plans: [basic, pro], selectedPlan: basic });
    const radios = root.querySelectorAll<HTMLInputElement>('input');

    expect(radios[0]!.checked).toBe(true);
    expect(radios[1]!.checked).toBe(false);

    radios[1]!.checked = true;
    radios[1]!.dispatchEvent(new Event('change', { bubbles: true }));
    await handle.flush();

    expect((handle.scope.bindingContext as { selectedPlan: unknown }).selectedPlan).toEqual(pro);
    expect(root.querySelector('p')!.textContent).toBe('Pro');
  });

  it('binds single selects using option models', async () => {
    const users = [
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Grace' }
    ];

    document.body.innerHTML = `
      <section id="app">
        <select value.bind="selectedUser">
          <option repeat.for="user of users" model.bind="user">\${user.name}</option>
        </select>
        <p>\${selectedUser.name}</p>
      </section>
    `;

    const root = document.querySelector('#app')!;
    const handle = enhance(root, { users, selectedUser: users[1] });
    await handle.flush();

    const select = root.querySelector('select')!;
    expect(select.selectedIndex).toBe(1);

    select.selectedIndex = 0;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await handle.flush();

    expect((handle.scope.bindingContext as { selectedUser: unknown }).selectedUser).toEqual(users[0]);
    expect(root.querySelector('p')!.textContent).toBe('Ada');
  });

  it('binds multiple selects to object model arrays', async () => {
    const tags = [
      { id: 'ts', name: 'TypeScript' },
      { id: 'ssr', name: 'SSR' },
      { id: 'forms', name: 'Forms' }
    ];

    document.body.innerHTML = `
      <section id="app">
        <select multiple value.bind="selectedTags">
          <option repeat.for="tag of tags" model.bind="tag">\${tag.name}</option>
        </select>
        <p>\${selectedTags.length}</p>
      </section>
    `;

    const root = document.querySelector('#app')!;
    const handle = enhance(root, { tags, selectedTags: [tags[0], tags[2]] });
    await handle.flush();

    const options = root.querySelectorAll<HTMLOptionElement>('option');
    expect(Array.from(options, option => option.selected)).toEqual([true, false, true]);

    options[0]!.selected = false;
    options[1]!.selected = true;
    root.querySelector('select')!.dispatchEvent(new Event('change', { bubbles: true }));
    await handle.flush();

    expect((handle.scope.bindingContext as { selectedTags: unknown[] }).selectedTags).toEqual([tags[1], tags[2]]);
    expect(root.querySelector('p')!.textContent).toBe('2');
  });

  it('supports files.from-view and rejects file value.bind in dev mode', async () => {
    document.body.innerHTML = `<input id="file" type="file" files.from-view="files">`;
    const handle = enhance(document.querySelector('#file')!, { files: null as FileList | null });
    const input = document.querySelector<HTMLInputElement>('#file')!;
    const fileList = { length: 1, item: () => null, 0: new File(['x'], 'x.txt') } as unknown as FileList;

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: fileList
    });

    input.dispatchEvent(new Event('change', { bubbles: true }));
    await handle.flush();

    expect((handle.scope.bindingContext as { files: FileList | null }).files).toBe(fileList);

    document.body.innerHTML = `<input id="bad-file" type="file" value.bind="fileValue">`;
    expect(() => enhance(document.querySelector('#bad-file')!, { fileValue: '' }, { dev: true }))
      .toThrow(LamiError);
  });
});

describe('repeat.for', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('preserves keyed nodes while reordering, inserting, and removing', async () => {
    const items = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' }
    ];

    document.body.innerHTML = `
      <ul id="items">
        <li repeat.for="item of items; key: id">\${item.name}</li>
      </ul>
    `;

    const root = document.querySelector('#items')!;
    const handle = enhance(root, { items });
    const [nodeA, nodeB, nodeC] = Array.from(root.querySelectorAll('li'));

    (handle.scope.bindingContext as { items: typeof items }).items = [
      items[2]!,
      items[0]!,
      { id: 'd', name: 'D' }
    ];
    await handle.flush();

    const nodes = Array.from(root.querySelectorAll('li'));
    expect(nodes.map(node => node.textContent)).toEqual(['C', 'A', 'D']);
    expect(nodes[0]).toBe(nodeC);
    expect(nodes[1]).toBe(nodeA);
    expect(nodes).not.toContain(nodeB);
  });

  it('renders numbers, sets, maps, and destructuring locals', async () => {
    document.body.innerHTML = `
      <section id="app">
        <span repeat.for="index of count">\${index}</span>
        <b repeat.for="item of set">\${item}</b>
        <i repeat.for="[key, value] of map">\${key}:\${value}</i>
        <em repeat.for="{ name } of users">\${name}</em>
      </section>
    `;

    const root = document.querySelector('#app')!;
    enhance(root, {
      count: 3,
      set: new Set(['x', 'y']),
      map: new Map([['a', 1], ['b', 2]]),
      users: [{ name: 'Ada' }, { name: 'Grace' }]
    });

    expect(Array.from(root.querySelectorAll('span'), node => node.textContent)).toEqual(['0', '1', '2']);
    expect(Array.from(root.querySelectorAll('b'), node => node.textContent)).toEqual(['x', 'y']);
    expect(Array.from(root.querySelectorAll('i'), node => node.textContent)).toEqual(['a:1', 'b:2']);
    expect(Array.from(root.querySelectorAll('em'), node => node.textContent)).toEqual(['Ada', 'Grace']);
  });

  it('exposes nested repeat parent locals through $parent', async () => {
    document.body.innerHTML = `
      <section id="app">
        <article repeat.for="category of categories">
          <p repeat.for="item of category.items">\${$parent.category.name}: \${item}</p>
        </article>
      </section>
    `;

    const root = document.querySelector('#app')!;
    const handle = enhance(root, {
      categories: [
        { name: 'Letters', items: ['A', 'B'] },
        { name: 'Numbers', items: ['1'] }
      ]
    });

    expect(Array.from(root.querySelectorAll('p'), node => node.textContent?.trim())).toEqual([
      'Letters: A',
      'Letters: B',
      'Numbers: 1'
    ]);

    (handle.scope.bindingContext as { categories: Array<{ name: string; items: string[] }> }).categories[0]!.name = 'Glyphs';
    await handle.flush();

    expect(root.querySelector('p')!.textContent?.trim()).toBe('Glyphs: A');
  });
});
