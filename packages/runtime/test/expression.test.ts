import { describe, expect, it } from 'vitest';
import { parseExpression, registerConverter, ResourceRegistry, Scope } from '../src';

describe('runtime expressions', () => {
  it('evaluates property access, calls, arrays, objects, and conditionals', () => {
    const scope = new Scope({
      user: { name: 'Dwayne', tags: ['typescript'] },
      enabled: true
    });

    expect(parseExpression("enabled ? user.name.toUpperCase() : 'no'").evaluate(scope)).toBe('DWAYNE');
    expect(parseExpression('[user.name, user.tags[0]]').evaluate(scope)).toEqual(['Dwayne', 'typescript']);
    expect(parseExpression('{ name: user.name, enabled }').evaluate(scope)).toEqual({ name: 'Dwayne', enabled: true });
  });

  it('assigns identifiers and members without eval', () => {
    const model = { count: 1, user: { name: 'Lami' } };
    const scope = new Scope(model);

    expect(parseExpression('count += 2').evaluate(scope)).toBe(3);
    parseExpression('user.name').assign?.(scope, 'Lami.js');

    expect(model).toEqual({ count: 3, user: { name: 'Lami.js' } });
  });

  it('runs value converters through a resource registry', () => {
    const resources = new ResourceRegistry();
    resources.registerConverter('currency', {
      toView(value: unknown, currency = 'USD') {
        return `${currency} ${Number(value).toFixed(2)}`;
      }
    });

    const scope = new Scope({ price: 12 });
    const expression = parseExpression("price | currency:'AUD'", { resources });

    expect(expression.evaluate(scope)).toBe('AUD 12.00');
  });

  it('uses globally registered converters', () => {
    registerConverter('upper', {
      toView(value: unknown) {
        return String(value).toUpperCase();
      }
    });

    expect(parseExpression('name | upper').evaluate(new Scope({ name: 'lami' }))).toBe('LAMI');
  });
});
