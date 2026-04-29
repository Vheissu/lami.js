import type { BehaviorCall, ExpressionNode } from '../expression/ast.js';
import { evaluateNode } from '../expression/evaluator.js';
import type { Scope } from '../expression/scope.js';
import { BindingMode, type Binding } from './binding.js';
import type {
  BindingBehavior,
  BindingBehaviorFactory,
  EventCallback,
  FromViewUpdate,
  ResourceRegistry
} from '../resources/registry.js';

const signalChannels = new Map<string, Set<Binding>>();

export function signal(name: string): void {
  const bindings = signalChannels.get(name);
  if (!bindings) return;
  for (const binding of [...bindings]) binding.refresh();
}

export function registerBuiltInBehaviors(registry: ResourceRegistry): void {
  registerBuiltIn(registry, 'debounce', debounce);
  registerBuiltIn(registry, 'throttle', throttle);
  registerBuiltIn(registry, 'updateTrigger', updateTrigger);
  registerBuiltIn(registry, 'signal', signalBehavior);
  registerBuiltIn(registry, 'attr', simpleBehavior({ forceAttribute: true }));
  registerBuiltIn(registry, 'oneTime', simpleBehavior({ mode: BindingMode.oneTime }));
  registerBuiltIn(registry, 'one-time', simpleBehavior({ mode: BindingMode.oneTime }));
  registerBuiltIn(registry, 'toView', simpleBehavior({ mode: BindingMode.toView }));
  registerBuiltIn(registry, 'to-view', simpleBehavior({ mode: BindingMode.toView }));
  registerBuiltIn(registry, 'oneWay', simpleBehavior({ mode: BindingMode.toView }));
  registerBuiltIn(registry, 'one-way', simpleBehavior({ mode: BindingMode.toView }));
  registerBuiltIn(registry, 'fromView', simpleBehavior({ mode: BindingMode.fromView }));
  registerBuiltIn(registry, 'from-view', simpleBehavior({ mode: BindingMode.fromView }));
  registerBuiltIn(registry, 'twoWay', simpleBehavior({ mode: BindingMode.twoWay }));
  registerBuiltIn(registry, 'two-way', simpleBehavior({ mode: BindingMode.twoWay }));
}

function registerBuiltIn(registry: ResourceRegistry, name: string, behavior: BindingBehaviorFactory): void {
  if (!registry.getBehavior(name)) {
    registry.registerBehavior(name, behavior);
  }
}

export function createBehaviorInstances(
  calls: BehaviorCall[],
  registry: ResourceRegistry
): BindingBehavior[] {
  return calls.map(call => {
    const factory = registry.getBehavior(call.name);
    if (!factory) {
      throw new Error(`Binding behavior "${call.name}" is not registered`);
    }
    return factory.create(call.args);
  });
}

export function getBehaviorMode(behaviors: BindingBehavior[]): BindingMode | undefined {
  return [...behaviors].reverse().find(behavior => behavior.mode)?.mode;
}

export function shouldForceAttribute(behaviors: BindingBehavior[]): boolean {
  return behaviors.some(behavior => behavior.forceAttribute);
}

export function getUpdateEvents(behaviors: BindingBehavior[], scope: Scope): string[] | undefined {
  for (let i = behaviors.length - 1; i >= 0; i--) {
    const events = behaviors[i]!.updateEvents?.(scope);
    if (events) return events;
  }
  return undefined;
}

export function bindBehaviors(behaviors: BindingBehavior[], binding: Binding, scope: Scope): void {
  for (const behavior of behaviors) {
    behavior.bind?.(binding, scope);
  }
}

export function unbindBehaviors(behaviors: BindingBehavior[], binding: Binding): void {
  for (let i = behaviors.length - 1; i >= 0; i--) {
    behaviors[i]!.unbind?.(binding);
  }
}

export function wrapFromView(
  behaviors: BindingBehavior[],
  callback: FromViewUpdate,
  scope: Scope
): FromViewUpdate {
  return behaviors.reduceRight((next, behavior) => behavior.wrapFromView?.(next, scope) ?? next, callback);
}

export function wrapEvent(
  behaviors: BindingBehavior[],
  callback: EventCallback,
  scope: Scope
): EventCallback {
  return behaviors.reduceRight((next, behavior) => behavior.wrapEvent?.(next, scope) ?? next, callback);
}

function simpleBehavior(options: Pick<BindingBehavior, 'mode' | 'forceAttribute'>): BindingBehaviorFactory {
  return {
    create() {
      return { ...options };
    }
  };
}

const updateTrigger: BindingBehaviorFactory = {
  create(args: ExpressionNode[]) {
    return {
      updateEvents(scope: Scope) {
        return args.map(arg => String(evaluateNode(arg, scope)));
      }
    };
  }
};

const signalBehavior: BindingBehaviorFactory = {
  create(args: ExpressionNode[]) {
    const subscriptions = new Map<Binding, string[]>();
    return {
      bind(binding, scope) {
        const names = args.map(arg => String(evaluateNode(arg, scope)));
        subscriptions.set(binding, names);
        for (const name of names) {
          let channel = signalChannels.get(name);
          if (!channel) {
            channel = new Set();
            signalChannels.set(name, channel);
          }
          channel.add(binding);
        }
      },
      unbind(binding) {
        for (const name of subscriptions.get(binding) ?? []) {
          signalChannels.get(name)?.delete(binding);
        }
        subscriptions.delete(binding);
      }
    };
  }
};

const debounce: BindingBehaviorFactory = {
  create(args: ExpressionNode[]) {
    return {
      wrapFromView(next, scope) {
        return debounceCallback(next, delay(args, scope));
      },
      wrapEvent(next, scope) {
        return debounceCallback(next, delay(args, scope));
      }
    };
  }
};

const throttle: BindingBehaviorFactory = {
  create(args: ExpressionNode[]) {
    return {
      wrapFromView(next, scope) {
        return throttleCallback(next, delay(args, scope));
      },
      wrapEvent(next, scope) {
        return throttleCallback(next, delay(args, scope));
      }
    };
  }
};

function delay(args: ExpressionNode[], scope: Scope): number {
  if (args.length === 0) return 0;
  return Number(evaluateNode(args[0]!, scope)) || 0;
}

function debounceCallback<T>(callback: (value: T) => void, wait: number): (value: T) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return value => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => callback(value), wait);
  };
}

function throttleCallback<T>(callback: (value: T) => void, wait: number): (value: T) => void {
  let last = 0;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  return value => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      if (trailing) clearTimeout(trailing);
      trailing = undefined;
      last = now;
      callback(value);
      return;
    }

    if (!trailing) {
      trailing = setTimeout(() => {
        last = Date.now();
        trailing = undefined;
        callback(value);
      }, remaining);
    }
  };
}
