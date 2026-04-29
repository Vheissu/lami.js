import { ReactiveEffect, type Cleanup } from './effect.js';
import { queueJob } from './scheduler.js';

export type WatchSource<T> = (() => T) | object;
export type WatchCallback<T> = (value: T, oldValue: T | undefined) => void;

export interface WatchOptions {
  immediate?: boolean;
  flush?: 'sync' | 'microtask';
}

export function watch<T>(source: WatchSource<T>, cb: WatchCallback<T>, options: WatchOptions = {}): Cleanup {
  const getter = typeof source === 'function'
    ? source as () => T
    : () => traverse(source) as T;

  let oldValue: T | undefined;
  let currentValue: T;

  const job = () => {
    runner.run();
    cb(currentValue, oldValue);
    oldValue = currentValue;
  };

  const scheduler = options.flush === 'sync'
    ? () => job()
    : () => queueJob(job);

  const runner = new ReactiveEffect(() => {
    currentValue = getter();
  }, scheduler);

  if (options.immediate) {
    job();
  } else {
    runner.run();
    oldValue = currentValue!;
  }

  return () => runner.stop();
}

function traverse(value: unknown, seen = new Set<unknown>()): unknown {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);

  if (value instanceof Map || value instanceof Set) {
    for (const item of value) traverse(item, seen);
    return value;
  }

  for (const key of Reflect.ownKeys(value)) {
    traverse((value as Record<PropertyKey, unknown>)[key], seen);
  }

  return value;
}
