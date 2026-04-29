import { describe, expect, it } from 'vitest';
import { renderRuntimeTemplate } from '../src';

describe('renderRuntimeTemplate', () => {
  it('renders interpolation, escaped attributes, if, and repeat', async () => {
    const html = await renderRuntimeTemplate(`
      <section title="\${title}">
        <h1>\${title}</h1>
        <p if.bind="show">\${message}</p>
        <p show.bind="show">visible</p>
        <p hide.bind="show" style="color: red">hidden</p>
        <p class="base" class.bind="classes" active.class="show" style="color: red" style.background-color.bind="background">styled</p>
        <span repeat.for="item of items">\${item}</span>
      </section>
    `, {
      title: '<Lami>',
      show: true,
      message: 'safe & sound',
      classes: ['dynamic'],
      background: 'blue',
      items: ['a', 'b']
    });

    expect(html).toContain('title="&lt;Lami&gt;"');
    expect(html).toContain('<h1>&lt;Lami&gt;</h1>');
    expect(html).toContain('<p>safe &amp; sound</p>');
    expect(html).toContain('<p>visible</p>');
    expect(html).toContain('<p style="color: red; display: none">hidden</p>');
    expect(html).toContain('<p class="base dynamic active" style="color: red; background-color: blue">styled</p>');
    expect(html).toContain('<span>a</span><span>b</span>');
  });

  it('renders with.bind, switch.bind, promise.bind, and spread attributes', async () => {
    const html = await renderRuntimeTemplate(`
      <main>
        <article with.bind="selectedUser">
          <h2>\${firstName} \${lastName}</h2>
        </article>

        <template switch.bind="status">
          <p case="pending">Pending</p>
          <p case.bind="['approved', 'accepted']">Approved</p>
          <p default-case>Unknown</p>
        </template>

        <div promise.bind="request">
          <span pending>Loading</span>
          <strong then="user">\${user.name}</strong>
          <em catch="error">\${error.message}</em>
        </div>

        <button ...button-attrs>Save</button>
      </main>
    `, {
      selectedUser: {
        firstName: 'Ada',
        lastName: 'Lovelace'
      },
      status: 'accepted',
      request: Promise.resolve({ name: '<Grace>' }),
      buttonAttrs: {
        disabled: true,
        title: 'Ready & waiting',
        'data-state': 'ok'
      }
    });

    expect(html).toContain('<h2>Ada Lovelace</h2>');
    expect(html).toContain('<p>Approved</p>');
    expect(html).toContain('<strong>&lt;Grace&gt;</strong>');
    expect(html).not.toContain('Loading');
    expect(html).toContain('<button disabled title="Ready &amp; waiting" data-state="ok">Save</button>');
  });

  it('renders rejected promises through catch branches', async () => {
    const html = await renderRuntimeTemplate(`
      <div promise.bind="request">
        <span pending>Loading</span>
        <strong then="user">\${user.name}</strong>
        <em catch="error">\${error.message}</em>
      </div>
    `, {
      request: Promise.reject(new Error('Nope & no'))
    });

    expect(html).toContain('<em>Nope &amp; no</em>');
    expect(html).not.toContain('Loading');
  });
});
