import { beforeEach, describe, expect, it } from 'vitest';
import { enhance, type Scope } from '../src';

describe('progressive enhancement lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('enhances inserted scoped islands and disposes them when removed', async () => {
    document.body.innerHTML = `
      <main id="app">
        <h1>\${title}</h1>
      </main>
    `;
    let newsletterModel: {
      email: string;
      subscribed: boolean;
      subscribe(event: Event): void;
    } | undefined;
    const root = document.querySelector('#app')!;
    const handle = enhance(root, { title: 'Host' }, {
      observeMutations: true,
      resources: {
        scopes: {
          newsletter(parent: Scope) {
            const host = parent.bindingContext as { title: string };
            newsletterModel = {
              email: `${host.title} email`,
              subscribed: false,
              subscribe(event: Event) {
                event.preventDefault();
                this.subscribed = true;
              }
            };
            return newsletterModel;
          }
        }
      }
    });
    const island = document.createElement('section');
    island.setAttribute('data-lami-scope', 'newsletter');
    island.innerHTML = `
      <form submit.trigger="subscribe($event)">
        <input value.bind="email">
        <p>\${email}</p>
        <strong if.bind="subscribed">Subscribed</strong>
      </form>
    `;

    root.append(island);
    await mutationTick();
    await handle.flush();

    const input = island.querySelector('input')!;
    expect(root.querySelector('h1')!.textContent).toBe('Host');
    expect(input.value).toBe('Host email');
    expect(island.querySelector('p')!.textContent).toBe('Host email');
    expect(island.querySelector('strong')).toBeNull();

    input.value = 'reader@example.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await handle.flush();

    expect(newsletterModel?.email).toBe('reader@example.com');
    expect(island.querySelector('p')!.textContent).toBe('reader@example.com');

    island.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await handle.flush();
    expect(newsletterModel?.subscribed).toBe(true);
    expect(island.querySelector('strong')!.textContent).toBe('Subscribed');

    newsletterModel!.subscribed = false;
    island.remove();
    await mutationTick();

    island.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await handle.flush();
    expect(newsletterModel?.subscribed).toBe(false);
  });

  it('auto-disposes bindings when the enhanced root is removed', async () => {
    const root = document.createElement('section');
    root.innerHTML = `<button @click="count += 1">\${count}</button>`;
    document.body.append(root);
    const model = { count: 0 };
    const handle = enhance(root, model, { autoDispose: true });
    const button = root.querySelector('button')!;

    expect(button.textContent).toBe('0');

    root.remove();
    await mutationTick();

    button.click();
    await handle.flush();

    expect(model.count).toBe(0);
    expect(button.textContent).toBe('0');
  });
});

async function mutationTick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
