import { beforeEach, describe, expect, it } from 'vitest';
import { BindingMode, defineElement, enhance, registerAttribute } from '../src';
import { LamiError, type LamiWarning } from '../src/util/errors';

describe('resources and binding safety', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('runs custom attribute lifecycle and batches propertiesChanged', async () => {
    const calls: string[] = [];

    class AuditAttribute {
      value = 0;
      label = '';

      binding(): void {
        calls.push('binding');
      }

      bound(): void {
        calls.push('bound');
      }

      attaching(): void {
        calls.push('attaching');
      }

      attached(): void {
        calls.push('attached');
      }

      detaching(): void {
        calls.push('detaching');
      }

      unbinding(): void {
        calls.push('unbinding');
      }

      valueChanged(value: unknown, oldValue: unknown): void {
        calls.push(`value:${String(oldValue)}->${String(value)}`);
      }

      labelChanged(value: unknown, oldValue: unknown): void {
        calls.push(`label:${String(oldValue)}->${String(value)}`);
      }

      propertiesChanged(changes: Record<string, unknown>): void {
        calls.push(`batch:${Object.keys(changes).sort().join(',')}`);
      }
    }

    registerAttribute('audit-attribute', {
      name: 'audit-attribute',
      Type: AuditAttribute,
      defaultProperty: 'value',
      bindables: {
        value: { set: Number },
        label: {}
      }
    });

    document.body.innerHTML = `<div id="target" audit-attribute="value.bind: count; label.bind: label"></div>`;
    const handle = enhance(document.querySelector('#target')!, { count: 1, label: 'one' });
    await handle.flush();
    await Promise.resolve();

    expect(calls).toEqual([
      'binding',
      'value:0->1',
      'label:->one',
      'bound',
      'attaching',
      'attached',
      'batch:label,value'
    ]);

    calls.length = 0;
    (handle.scope.bindingContext as { count: number; label: string }).count = 2;
    (handle.scope.bindingContext as { count: number; label: string }).label = 'two';
    await handle.flush();
    await Promise.resolve();

    expect(calls).toEqual([
      'value:1->2',
      'label:one->two',
      'batch:label,value'
    ]);

    handle.dispose();
    expect(calls.slice(-2)).toEqual(['detaching', 'unbinding']);
  });

  it('assigns custom attribute and custom element refs and clears them on dispose', () => {
    class TooltipRefAttribute {
      text = '';
    }

    class RefCard {
      user = { name: '' };
    }

    registerAttribute('resource-ref-tooltip', {
      name: 'resource-ref-tooltip',
      Type: TooltipRefAttribute,
      defaultProperty: 'text',
      bindables: {
        text: {}
      }
    });

    defineElement('ref-card', {
      name: 'ref-card',
      Type: RefCard,
      bindables: {
        user: { mode: BindingMode.toView }
      },
      template: `<article>\${user.name}</article>`
    });

    const model: {
      selected: { name: string };
      tooltip?: TooltipRefAttribute;
      card?: RefCard;
      cardController?: unknown;
    } = {
      selected: { name: 'Ada' }
    };

    document.body.innerHTML = `
      <section id="app">
        <button resource-ref-tooltip="text.bind: selected.name" resource-ref-tooltip.ref="tooltip"></button>
        <ref-card user.bind="selected" component.ref="card" controller.ref="cardController"></ref-card>
      </section>
    `;

    const handle = enhance(document.querySelector('#app')!, model);

    expect(model.tooltip).toBeInstanceOf(TooltipRefAttribute);
    expect(model.tooltip?.text).toBe('Ada');
    expect(model.card).toBeInstanceOf(RefCard);
    expect(model.card?.user).toEqual({ name: 'Ada' });
    expect(model.cardController).toBeTruthy();

    handle.dispose();
    expect(model.tooltip).toBeUndefined();
    expect(model.card).toBeUndefined();
    expect(model.cardController).toBeUndefined();
  });

  it('rejects assignment in to-view bindings in dev mode but allows it in events', async () => {
    document.body.innerHTML = `<p id="bad" title.bind="count = 1"></p>`;
    expect(() => enhance(document.querySelector('#bad')!, { count: 0 }, { dev: true }))
      .toThrow(LamiError);

    document.body.innerHTML = `<button id="good" click.trigger="count = 1">\${count}</button>`;
    const handle = enhance(document.querySelector('#good')!, { count: 0 }, { dev: true });
    document.querySelector('#good')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await handle.flush();

    expect(document.querySelector('#good')!.textContent).toBe('1');
  });

  it('reports runtime binding errors through onError without tearing down the app', async () => {
    const errors: LamiError[] = [];
    document.body.innerHTML = `
      <section id="app">
        <button click.trigger="save()">Save</button>
        <p>\${count}</p>
      </section>
    `;
    const handle = enhance(document.querySelector('#app')!, {
      count: 0,
      save() {
        this.count++;
        throw new Error('save failed');
      }
    }, {
      onError: error => errors.push(error)
    });

    document.querySelector<HTMLButtonElement>('button')!.click();
    await handle.flush();

    expect(document.querySelector('p')!.textContent).toBe('1');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      name: 'LamiError',
      code: 'E_BINDING',
      message: 'save failed'
    });
    expect(errors[0]!.details).toMatchObject({
      phase: 'event',
      expression: 'save()',
      event: 'click'
    });
  });

  it('reports production warnings for missing value converters', () => {
    const warnings: LamiWarning[] = [];
    document.body.innerHTML = `<p id="app">\${name | missingConverter}</p>`;

    enhance(document.querySelector('#app')!, { name: 'Ada' }, {
      onWarn: warning => warnings.push(warning)
    });

    expect(document.querySelector('#app')!.textContent).toBe('Ada');
    expect(warnings).toEqual([
      expect.objectContaining({
        name: 'LamiWarning',
        code: 'W_RESOURCE_MISSING',
        message: 'Value converter "missingConverter" is not registered'
      })
    ]);
  });
});
