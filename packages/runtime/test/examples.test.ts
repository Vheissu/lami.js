import { beforeEach, describe, expect, it } from 'vitest';
import { mountPostFormExample, type PostFetch } from '../../../examples/post-form/src/main';
import { mountTodoExample } from '../../../examples/todo-app/src/main';

describe('example apps', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('runs the todo example through real rendered interactions', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    const app = mountTodoExample(root, {
      todos: [
        { id: 1, title: 'Alpha', done: false },
        { id: 2, title: 'Beta', done: true }
      ]
    });

    expect(itemText(root)).toEqual(['AlphaRemove', 'BetaRemove']);
    expect(root.querySelector('.summary')!.textContent).toBe('1 open, 1 done');

    const input = root.querySelector<HTMLInputElement>('.entry input')!;
    input.value = 'Gamma';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await app.flush();
    expect(root.querySelector<HTMLButtonElement>('.entry button')!.disabled).toBe(false);

    root.querySelector<HTMLButtonElement>('.entry button')!.click();
    await app.flush();

    expect(input.value).toBe('');
    expect(itemText(root)).toEqual(['AlphaRemove', 'BetaRemove', 'GammaRemove']);
    expect(root.querySelector('.summary')!.textContent).toBe('2 open, 1 done');

    const firstCheckbox = root.querySelector<HTMLInputElement>('.todo-list input')!;
    firstCheckbox.checked = true;
    firstCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    await app.flush();

    expect(root.querySelector('.summary')!.textContent).toBe('1 open, 2 done');

    const doneFilter = Array.from(root.querySelectorAll<HTMLButtonElement>('.filters button'))
      .find(button => button.textContent === 'Done')!;
    doneFilter.click();
    await app.flush();

    expect(itemText(root)).toEqual(['AlphaRemove', 'BetaRemove']);

    root.querySelector<HTMLButtonElement>('.footer button')!.click();
    await app.flush();

    expect(root.querySelector('.empty')!.textContent).toBe('Nothing in this view.');
  });

  it('runs the post form example through successful and failed fetch submissions', async () => {
    const root = document.createElement('main');
    document.body.append(root);
    const requests: Array<{ input: string; init: RequestInit }> = [];
    let shouldFail = false;
    const fetcher: PostFetch = async (input, init) => {
      requests.push({ input, init });
      if (shouldFail) {
        return {
          ok: false,
          status: 503,
          json: async () => ({})
        };
      }

      const payload = JSON.parse(String(init.body)) as { title: string };
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: 42, title: payload.title })
      };
    };
    const app = mountPostFormExample(root, {
      endpoint: '/api/posts',
      fetcher
    });

    await fillAndSubmit(root, app, 'First post', 'A body worth sending.');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      input: '/api/posts',
      init: {
        method: 'POST'
      }
    });
    expect(root.querySelector('.success')!.textContent).toBe('Created post #42: First post');
    expect(root.querySelector<HTMLInputElement>('input')!.value).toBe('');
    expect(root.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');

    shouldFail = true;
    await fillAndSubmit(root, app, 'Broken post', 'This one will fail.');

    expect(requests).toHaveLength(2);
    expect(root.querySelector('.error')!.textContent).toBe('Could not post: Request failed with HTTP 503');
  });
});

async function fillAndSubmit(
  root: Element,
  app: { flush(): Promise<void> },
  title: string,
  body: string
): Promise<void> {
  const titleInput = root.querySelector<HTMLInputElement>('input')!;
  const bodyInput = root.querySelector<HTMLTextAreaElement>('textarea')!;
  titleInput.value = title;
  titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  bodyInput.value = body;
  bodyInput.dispatchEvent(new Event('input', { bubbles: true }));
  await app.flush();

  root.querySelector<HTMLButtonElement>('form button')!.click();
  await Promise.resolve();
  await Promise.resolve();
  await app.flush();
}

function itemText(root: Element): string[] {
  return Array.from(root.querySelectorAll('.todo-list li'), item => item.textContent?.trim().replace(/\s+/g, '') ?? '');
}
