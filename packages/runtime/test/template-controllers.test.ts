import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enhance } from '../src';

describe('template controllers and spread bindings', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('binds with.bind content to the selected context and updates when it changes', async () => {
    const ada = { firstName: 'Ada', lastName: 'Lovelace' };
    const grace = { firstName: 'Grace', lastName: 'Hopper' };

    document.body.innerHTML = `
      <section id="app">
        <article with.bind="selectedUser">
          <h2>\${firstName} \${lastName}</h2>
        </article>
      </section>
    `;

    const root = document.querySelector('#app')!;
    const handle = enhance(root, { selectedUser: ada });

    expect(root.querySelector('h2')!.textContent).toBe('Ada Lovelace');

    (handle.scope.bindingContext as { selectedUser: typeof grace }).selectedUser = grace;
    await handle.flush();

    expect(root.querySelector('h2')!.textContent).toBe('Grace Hopper');
  });

  it('renders switch cases and default-case as the switch value changes', async () => {
    document.body.innerHTML = `
      <section id="app">
        <template switch.bind="status">
          <p case="pending">Pending</p>
          <p case.bind="['approved', 'accepted']">Approved</p>
          <p default-case>Unknown</p>
        </template>
      </section>
    `;

    const root = document.querySelector('#app')!;
    const handle = enhance(root, { status: 'pending' });

    expect(root.querySelector('p')!.textContent).toBe('Pending');

    (handle.scope.bindingContext as { status: string }).status = 'approved';
    await handle.flush();
    expect(root.querySelector('p')!.textContent).toBe('Approved');

    (handle.scope.bindingContext as { status: string }).status = 'rejected';
    await handle.flush();
    expect(root.querySelector('p')!.textContent).toBe('Unknown');
  });

  it('renders promise pending, then, catch, and ignores stale resolutions', async () => {
    let resolveFirst!: (value: { name: string }) => void;
    let resolveSecond!: (value: { name: string }) => void;

    const first = new Promise<{ name: string }>(resolve => {
      resolveFirst = resolve;
    });
    const second = new Promise<{ name: string }>(resolve => {
      resolveSecond = resolve;
    });

    document.body.innerHTML = `
      <section id="app">
        <div promise.bind="request">
          <span pending>Loading</span>
          <strong then="user">\${user.name}</strong>
          <em catch="error">\${error.message}</em>
        </div>
      </section>
    `;

    const root = document.querySelector('#app')!;
    const handle = enhance(root, { request: first });

    expect(root.querySelector('span')!.textContent).toBe('Loading');

    (handle.scope.bindingContext as { request: Promise<{ name: string }> }).request = second;
    await handle.flush();
    resolveFirst({ name: 'Old' });
    resolveSecond({ name: 'Fresh' });
    await Promise.resolve();
    await handle.flush();

    expect(root.querySelector('strong')!.textContent).toBe('Fresh');
    expect(root.querySelector('em')).toBeNull();

    (handle.scope.bindingContext as { request: Promise<unknown> }).request = Promise.reject(new Error('Nope'));
    await handle.flush();
    await Promise.resolve();
    await handle.flush();

    expect(root.querySelector('em')!.textContent).toBe('Nope');
  });

  it('applies native spread bindings reactively', async () => {
    document.body.innerHTML = `
      <section id="app">
        <button ...button-attrs>Save</button>
      </section>
    `;

    const root = document.querySelector('#app')!;
    const handle = enhance(root, {
      buttonAttrs: {
        disabled: true,
        title: 'Wait',
        'data-state': 'busy'
      }
    });
    const button = root.querySelector('button')!;

    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Wait');
    expect(button.getAttribute('data-state')).toBe('busy');

    (handle.scope.bindingContext as { buttonAttrs: Record<string, unknown> }).buttonAttrs = {
      disabled: false,
      title: 'Ready',
      'data-state': null
    };
    await handle.flush();

    expect(button.disabled).toBe(false);
    expect(button.title).toBe('Ready');
    expect(button.hasAttribute('data-state')).toBe(false);
  });

  it('focus.bind syncs focus state in both directions', async () => {
    document.body.innerHTML = `
      <section id="app">
        <input focus.bind="isFocused">
        <p>\${isFocused ? 'focused' : 'blurred'}</p>
      </section>
    `;

    const root = document.querySelector('#app')!;
    const handle = enhance(root, { isFocused: false });
    const input = root.querySelector('input')!;

    (handle.scope.bindingContext as { isFocused: boolean }).isFocused = true;
    await handle.flush();
    await Promise.resolve();
    expect(document.activeElement).toBe(input);

    input.blur();
    input.dispatchEvent(new FocusEvent('blur'));
    await handle.flush();

    expect(root.querySelector('p')!.textContent).toBe('blurred');
  });
});
