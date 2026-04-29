import { reactive } from '../reactivity/reactive.js';

const defaultGlobals = new Map<string, unknown>([
  ['Math', Math],
  ['Number', Number],
  ['String', String],
  ['Boolean', Boolean],
  ['Array', Array],
  ['Object', Object],
  ['Date', Date],
  ['Intl', Intl],
  ['JSON', JSON],
  ['parseInt', parseInt],
  ['parseFloat', parseFloat],
  ['isNaN', isNaN],
  ['isFinite', isFinite]
]);

export class Scope {
  public readonly locals: Record<string, unknown>;

  constructor(
    public readonly bindingContext: object,
    public readonly parent: Scope | null = null,
    locals: Record<string, unknown> = Object.create(null)
  ) {
    this.locals = reactive(locals);
  }

  withContext(bindingContext: object): Scope {
    return new Scope(bindingContext, this, Object.create(null));
  }

  withLocals(locals: Record<string, unknown>): Scope {
    return new Scope(this.bindingContext, this, locals);
  }

  withLocal(name: string, value: unknown): Scope {
    return this.withLocals({ [name]: value });
  }
}

export function registerGlobal(name: string, value: unknown): void {
  defaultGlobals.set(name, value);
}

export function getGlobal(name: string): unknown {
  return defaultGlobals.get(name);
}

export function getIdentifier(scope: Scope, name: string): unknown {
  if (name === '$this') return scope.bindingContext;
  if (name === '$parent') return scope.parent ? scopeContext(scope.parent) : undefined;

  let cursor: Scope | null = scope;
  while (cursor) {
    if (Object.prototype.hasOwnProperty.call(cursor.locals, name)) {
      return cursor.locals[name];
    }

    if (name in cursor.bindingContext) {
      return (cursor.bindingContext as Record<string, unknown>)[name];
    }

    cursor = cursor.parent;
  }

  return getGlobal(name);
}

function scopeContext(scope: Scope): object {
  return new Proxy(Object.create(null) as Record<PropertyKey, unknown>, {
    has(_target, key) {
      if (key === '$parent') return scope.parent !== null;
      return key in scope.locals || key in scope.bindingContext;
    },

    get(_target, key) {
      if (key === '$parent') return scope.parent ? scopeContext(scope.parent) : undefined;
      if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(scope.locals, key)) {
        return scope.locals[key];
      }
      return (scope.bindingContext as Record<PropertyKey, unknown>)[key];
    },

    set(_target, key, value) {
      if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(scope.locals, key)) {
        scope.locals[key] = value;
      } else {
        (scope.bindingContext as Record<PropertyKey, unknown>)[key] = value;
      }
      return true;
    }
  });
}

export function setIdentifier(scope: Scope, name: string, value: unknown): void {
  let cursor: Scope | null = scope;
  while (cursor) {
    if (Object.prototype.hasOwnProperty.call(cursor.locals, name)) {
      cursor.locals[name] = value;
      return;
    }

    if (name in cursor.bindingContext) {
      (cursor.bindingContext as Record<string, unknown>)[name] = value;
      return;
    }

    cursor = cursor.parent;
  }

  (scope.bindingContext as Record<string, unknown>)[name] = value;
}
