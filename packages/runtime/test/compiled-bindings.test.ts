import { describe, expect, it } from 'vitest';
import { BindingMode } from '../src';
import {
  bindAttributeCompiled,
  bindEventCompiled,
  bindPropertyCompiled,
  bindSpreadCompiled,
  bindTextCompiled,
  createCompiledApp,
  createTemplate,
  path
} from '../src/internal';

describe('compiled binding helpers', () => {
  it('binds text, attributes, properties, events, and spread without DOM scanning', async () => {
    const template = createTemplate(`
      <section>
        <h1></h1>
        <input>
        <button>Save</button>
      </section>
    `);
    const fragment = template.clone();
    const section = path(fragment, [1]) as HTMLElement;
    const heading = path(fragment, [1, 1]) as HTMLHeadingElement;
    const input = path(fragment, [1, 3]) as HTMLInputElement;
    const button = path(fragment, [1, 5]) as HTMLButtonElement;
    const model = {
      name: 'Lami',
      title: 'Hello',
      buttonAttrs: {
        disabled: true,
        'data-state': 'busy'
      },
      save() {
        this.name = 'Saved';
      }
    };
    const app = createCompiledApp(section, model);

    bindTextCompiled(app, heading.appendChild(document.createTextNode('')), [
      { type: 'text', value: 'Name: ' },
      { type: 'expression', source: 'name' }
    ]);
    bindAttributeCompiled(app, heading, 'title', [
      { type: 'expression', source: 'title' }
    ]);
    bindPropertyCompiled(app, input, 'value', BindingMode.twoWay, 'name');
    bindEventCompiled(app, button, 'click', false, [], 'save()');
    bindSpreadCompiled(app, button, 'buttonAttrs');

    document.body.append(fragment);
    app.bind();

    expect(heading.textContent).toBe('Name: Lami');
    expect(heading.title).toBe('Hello');
    expect(input.value).toBe('Lami');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('data-state')).toBe('busy');

    input.value = 'Lami.js';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await app.flush();

    expect(heading.textContent).toBe('Name: Lami.js');

    button.disabled = false;
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await app.flush();

    expect(heading.textContent).toBe('Name: Saved');
  });
});
