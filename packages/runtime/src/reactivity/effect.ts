import { queueJob } from './scheduler.js';

export type EffectFn = () => void;
export type Cleanup = () => void;
export type Key = string | symbol;
export type Dependency = Set<ReactiveEffect>;

export interface EffectOptions {
  scheduler?: (job: () => void) => void;
  lazy?: boolean;
  onStop?: () => void;
}

export interface EffectHandle {
  run(): void;
  stop(): void;
}

const targetMap = new WeakMap<object, Map<Key, Dependency>>();
const effectStack: ReactiveEffect[] = [];
let activeEffect: ReactiveEffect | undefined;

export const ITERATE_KEY = Symbol('iterate');

export class ReactiveEffect implements EffectHandle {
  deps: Dependency[] = [];
  active = true;
  private readonly job = () => this.run();

  constructor(
    public readonly fn: EffectFn,
    public readonly scheduler: (job: () => void) => void = queueJob,
    public readonly onStop?: () => void
  ) {}

  run(): void {
    if (!this.active) {
      this.fn();
      return;
    }

    cleanupEffect(this);
    try {
      effectStack.push(this);
      activeEffect = this;
      this.fn();
    } finally {
      effectStack.pop();
      activeEffect = effectStack[effectStack.length - 1];
    }
  }

  schedule(): void {
    this.scheduler(this.job);
  }

  stop(): void {
    if (!this.active) return;
    cleanupEffect(this);
    this.active = false;
    this.onStop?.();
  }
}

function cleanupEffect(instance: ReactiveEffect): void {
  for (const dep of instance.deps) dep.delete(instance);
  instance.deps.length = 0;
}

export function effect(fn: EffectFn, options: EffectOptions = {}): EffectHandle {
  const instance = new ReactiveEffect(fn, options.scheduler ?? queueJob, options.onStop);
  if (!options.lazy) instance.run();
  return instance;
}

export function track(target: object, key: Key): void {
  if (!activeEffect) return;

  let depsMap = targetMap.get(target);
  if (!depsMap) {
    depsMap = new Map();
    targetMap.set(target, depsMap);
  }

  let dep = depsMap.get(key);
  if (!dep) {
    dep = new Set();
    depsMap.set(key, dep);
  }

  if (dep.has(activeEffect)) return;
  dep.add(activeEffect);
  activeEffect.deps.push(dep);
}

export function trigger(target: object, key: Key): void {
  const depsMap = targetMap.get(target);
  if (!depsMap) return;

  const effects = new Set<ReactiveEffect>();
  const add = (dep?: Dependency): void => {
    if (!dep) return;
    for (const instance of dep) effects.add(instance);
  };

  add(depsMap.get(key));

  if (key === 'length' || key === ITERATE_KEY) {
    add(depsMap.get(ITERATE_KEY));
  }

  for (const instance of effects) {
    instance.schedule();
  }
}
