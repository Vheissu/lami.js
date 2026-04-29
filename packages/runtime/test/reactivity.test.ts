import { describe, expect, it, vi } from 'vitest';
import { computed, effect, flushJobs, reactive, Scope, watch } from '../src';

describe('reactivity', () => {
  it('runs effects only when tracked properties change', async () => {
    const model = reactive({ count: 0, name: 'Lami' });
    const spy = vi.fn(() => model.count);

    effect(spy);
    expect(spy).toHaveReturnedWith(0);

    model.name = 'Other';
    await flushJobs();
    expect(spy).toHaveBeenCalledTimes(1);

    model.count = 2;
    await flushJobs();
    expect(spy).toHaveReturnedWith(2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('supports computed refs and watchers', async () => {
    const model = reactive({ first: 'La', last: 'mi' });
    const fullName = computed(() => `${model.first}${model.last}`);
    const changes: Array<[string, string | undefined]> = [];

    watch(() => fullName.value, (value, oldValue) => {
      changes.push([value, oldValue]);
    });

    expect(fullName.value).toBe('Lami');
    model.last = '.js';
    await flushJobs();

    expect(fullName.value).toBe('La.js');
    expect(changes).toEqual([['La.js', 'Lami']]);
  });

  it('leaves DOM events raw so browser-native methods keep their receiver', () => {
    const event = new Event('submit');
    const model = reactive({ event });
    const scope = new Scope({}).withLocal('$event', event);

    expect(model.event).toBe(event);
    expect(scope.locals.$event).toBe(event);
  });
});
