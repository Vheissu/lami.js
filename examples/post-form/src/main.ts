import { enhance, type AppHandle } from '@lami.js/runtime';

export interface PostResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type PostFetch = (input: string, init: RequestInit) => Promise<PostResponseLike>;

export interface PostFormOptions {
  endpoint?: string;
  fetcher?: PostFetch;
}

export const postFormTemplate = `
  <section class="post-shell">
    <header>
      <p>Fetch example</p>
      <h1>Publish a note</h1>
    </header>

    <form @submit:prevent="submit($event)">
      <label>
        <span>Title</span>
        <input value.bind="title" placeholder="Release notes">
      </label>

      <label>
        <span>Body</span>
        <textarea value.bind="body & updateTrigger:'input':'blur'" rows="6" placeholder="What changed?"></textarea>
      </label>

      <button disabled.bind="!canSubmit">\${submitLabel}</button>
    </form>

    <aside class="status" aria-live="polite">
      <p if.bind="status === 'idle'">Fill the form and submit JSON to the endpoint.</p>
      <p if.bind="status === 'submitting'">Posting...</p>
      <p class="success" if.bind="status === 'success'">Created post #\${createdId}: \${createdTitle}</p>
      <p class="error" if.bind="status === 'error'">Could not post: \${error}</p>
    </aside>
  </section>
`;

export class PostFormModel {
  title = '';
  body = '';
  status: 'idle' | 'submitting' | 'success' | 'error' = 'idle';
  error = '';
  createdId = '';
  createdTitle = '';
  readonly endpoint: string;
  readonly fetcher: PostFetch;

  constructor(options: PostFormOptions = {}) {
    this.endpoint = options.endpoint ?? '/api/posts';
    this.fetcher = options.fetcher ?? defaultFetch;
  }

  get canSubmit(): boolean {
    return this.status !== 'submitting' &&
      this.title.trim().length > 0 &&
      this.body.trim().length > 0;
  }

  get submitLabel(): string {
    return this.status === 'submitting' ? 'Posting' : 'Post note';
  }

  async submit(event?: Event): Promise<void> {
    event?.preventDefault();
    if (!this.canSubmit) return;

    this.status = 'submitting';
    this.error = '';
    this.createdId = '';
    this.createdTitle = '';

    try {
      const title = this.title.trim();
      const response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          title,
          body: this.body.trim()
        })
      });

      if (!response.ok) {
        throw new Error(`Request failed with HTTP ${response.status}`);
      }

      const data = await response.json() as { id?: unknown; title?: unknown };
      this.createdId = data.id === undefined ? 'pending' : String(data.id);
      this.createdTitle = String(data.title ?? title);
      this.title = '';
      this.body = '';
      this.status = 'success';
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.status = 'error';
    }
  }
}

export function createPostFormExample(options: PostFormOptions = {}): PostFormModel {
  return new PostFormModel(options);
}

export function mountPostFormExample(
  root: Element,
  options: PostFormOptions = {}
): AppHandle {
  root.innerHTML = postFormTemplate;
  return enhance(root, createPostFormExample(options));
}

async function defaultFetch(input: string, init: RequestInit): Promise<PostResponseLike> {
  return await fetch(input, init);
}

const browserRoot = typeof document === 'undefined'
  ? null
  : document.querySelector('[data-lami-example="post-form"]');

if (browserRoot) {
  mountPostFormExample(browserRoot);
}
