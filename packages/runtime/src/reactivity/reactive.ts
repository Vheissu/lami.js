import { ITERATE_KEY, type Key, track, trigger } from './effect.js';

const proxyToRaw = new WeakMap<object, object>();
const rawToProxy = new WeakMap<object, object>();
const rawToReadonlyProxy = new WeakMap<object, object>();
const rawValues = new WeakSet<object>();

export function markRaw<T extends object>(value: T): T {
  rawValues.add(value);
  return value;
}

export function raw<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  return (proxyToRaw.get(value) as T | undefined) ?? value;
}

export function reactive<T extends object>(value: T): T {
  return createReactive(value, false);
}

export function readonly<T extends object>(value: T): T {
  return createReactive(value, true);
}

function createReactive<T extends object>(target: T, isReadonly: boolean): T {
  if (!canProxy(target)) return target;

  const source = raw(target);
  const cache = isReadonly ? rawToReadonlyProxy : rawToProxy;
  const existing = cache.get(source);
  if (existing) return existing as T;

  const handler = source instanceof Map || source instanceof Set
    ? mapSetHandler(isReadonly)
    : objectHandler(isReadonly);
  const proxy = new Proxy(source, handler as ProxyHandler<object>);
  cache.set(source, proxy);
  proxyToRaw.set(proxy, source);
  return proxy as T;
}

function canProxy(value: object): boolean {
  if (rawValues.has(value)) return false;
  if (!Object.isExtensible(value)) return false;
  if (typeof Event !== 'undefined' && value instanceof Event) return false;
  if (typeof Node !== 'undefined' && value instanceof Node) return false;
  if (value instanceof Date) return false;
  if (value instanceof RegExp) return false;
  if (value instanceof Promise) return false;
  if (value instanceof WeakMap) return false;
  if (value instanceof WeakSet) return false;
  if (ArrayBuffer.isView(value)) return false;
  if (value instanceof ArrayBuffer) return false;
  return true;
}

function objectHandler(isReadonly: boolean): ProxyHandler<object> {
  return {
    get(target, key, receiver) {
      if (key === '__raw') return target;

      const value = Reflect.get(target, key, receiver);
      track(target, key as Key);

      if (typeof value === 'object' && value !== null) {
        return createReactive(value, isReadonly);
      }

      return value;
    },

    set(target, key, value, receiver) {
      if (isReadonly) return true;

      const oldValue = Reflect.get(target, key, receiver);
      const hadKey = Object.prototype.hasOwnProperty.call(target, key);
      const result = Reflect.set(target, key, value, receiver);

      if (!Object.is(oldValue, value)) {
        trigger(target, key as Key);
        if (!hadKey) trigger(target, ITERATE_KEY);
        if (Array.isArray(target) && key !== 'length') {
          trigger(target, ITERATE_KEY);
          trigger(target, 'length');
        }
      }

      return result;
    },

    deleteProperty(target, key) {
      if (isReadonly) return true;

      const hadKey = Object.prototype.hasOwnProperty.call(target, key);
      const result = Reflect.deleteProperty(target, key);

      if (hadKey && result) {
        trigger(target, key as Key);
        trigger(target, ITERATE_KEY);
        if (Array.isArray(target)) trigger(target, 'length');
      }

      return result;
    },

    ownKeys(target) {
      track(target, Array.isArray(target) ? 'length' : ITERATE_KEY);
      return Reflect.ownKeys(target);
    }
  };
}

function mapSetHandler(isReadonly: boolean): ProxyHandler<Map<unknown, unknown> | Set<unknown>> {
  return {
    get(target, key, receiver) {
      if (key === '__raw') return target;

      if (key === 'size') {
        track(target, ITERATE_KEY);
        return Reflect.get(target, key, target);
      }

      if (key === Symbol.iterator || key === 'entries' || key === 'values' || key === 'keys') {
        track(target, ITERATE_KEY);
        return Reflect.get(target, key, target).bind(target);
      }

      if (key === 'get' && target instanceof Map) {
        return (mapKey: unknown) => {
          track(target, mapKey as Key);
          const value = target.get(mapKey);
          return typeof value === 'object' && value !== null
            ? createReactive(value, isReadonly)
            : value;
        };
      }

      if (key === 'has') {
        return (value: unknown) => {
          track(target, target instanceof Map ? value as Key : ITERATE_KEY);
          return target.has(value);
        };
      }

      if (key === 'set' && target instanceof Map) {
        return (mapKey: unknown, value: unknown) => {
          if (isReadonly) return receiver;
          const had = target.has(mapKey);
          const oldValue = target.get(mapKey);
          target.set(mapKey, value);
          if (!had || !Object.is(oldValue, value)) {
            trigger(target, mapKey as Key);
            trigger(target, ITERATE_KEY);
          }
          return receiver;
        };
      }

      if (key === 'add' && target instanceof Set) {
        return (value: unknown) => {
          if (isReadonly) return receiver;
          const had = target.has(value);
          target.add(value);
          if (!had) trigger(target, ITERATE_KEY);
          return receiver;
        };
      }

      if (key === 'delete') {
        return (value: unknown) => {
          if (isReadonly) return false;
          const result = target.delete(value);
          if (result) {
            trigger(target, value as Key);
            trigger(target, ITERATE_KEY);
          }
          return result;
        };
      }

      if (key === 'clear') {
        return () => {
          if (isReadonly) return;
          const hadItems = target.size > 0;
          target.clear();
          if (hadItems) trigger(target, ITERATE_KEY);
        };
      }

      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  };
}
