import { ReactiveEffect, track, trigger } from './effect.js';

export interface ComputedRef<T> {
  readonly value: T;
}

export function computed<T>(fn: () => T): ComputedRef<T> {
  let value: T;
  let dirty = true;

  const ref = {
    get value(): T {
      track(ref, 'value');
      if (dirty) {
        dirty = false;
        runner.run();
      }
      return value!;
    }
  };

  const runner = new ReactiveEffect(
    () => {
      value = fn();
    },
    () => {
      if (!dirty) {
        dirty = true;
        trigger(ref, 'value');
      }
    }
  );

  return ref;
}
