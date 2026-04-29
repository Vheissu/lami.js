import { effect, type EffectHandle } from '../reactivity/effect.js';
import type { Cleanup } from '../util/dom.js';
import { reportError, type ErrorReporter } from '../util/errors.js';

export const enum BindingMode {
  oneTime = 'oneTime',
  toView = 'toView',
  fromView = 'fromView',
  twoWay = 'twoWay'
}

export interface Binding {
  id: number;
  mode: BindingMode;
  bind(): void;
  refresh(): void;
  unbind(): void;
}

export abstract class BindingController implements Binding {
  private cleanups: Cleanup[] = [];
  private effectHandle: EffectHandle | undefined;
  private diagnostics: ErrorReporter | undefined;

  constructor(
    public readonly id: number,
    public readonly mode: BindingMode
  ) {}

  onDispose(cleanup: Cleanup): void {
    this.cleanups.push(cleanup);
  }

  setDiagnostics(diagnostics: ErrorReporter | undefined): void {
    this.diagnostics = diagnostics;
  }

  protected runEffect(fn: () => void, phase = 'refresh'): void {
    this.effectHandle = effect(() => {
      this.runWithDiagnostics(phase, fn);
    });
  }

  runWithDiagnostics<T>(
    phase: string,
    fn: () => T,
    details?: Record<string, unknown>
  ): T | undefined {
    try {
      return fn();
    } catch (error) {
      reportError(this.diagnostics, 'E_BINDING', error, {
        bindingId: this.id,
        bindingMode: this.mode,
        phase,
        ...details
      });
      return undefined;
    }
  }

  abstract bind(): void;
  abstract refresh(): void;

  unbind(): void {
    this.effectHandle?.stop();
    this.effectHandle = undefined;

    for (let i = this.cleanups.length - 1; i >= 0; i--) {
      this.cleanups[i]!();
    }

    this.cleanups.length = 0;
  }
}

export function isDefaultTwoWayTarget(element: Element, target: string): boolean {
  if (target === 'focus') return true;
  const key = `${element.tagName}:${target}`;
  return defaultTwoWayTargets.has(key);
}

export function resolveMode(
  command: string | null,
  element: Element,
  target: string,
  explicitBehaviorMode?: BindingMode
): BindingMode {
  if (explicitBehaviorMode) return explicitBehaviorMode;

  switch (command) {
    case 'one-time': return BindingMode.oneTime;
    case 'to-view': return BindingMode.toView;
    case 'one-way': return BindingMode.toView;
    case 'from-view': return BindingMode.fromView;
    case 'two-way': return BindingMode.twoWay;
    case 'bind': return isDefaultTwoWayTarget(element, target)
      ? BindingMode.twoWay
      : BindingMode.toView;
    default: return BindingMode.toView;
  }
}

const defaultTwoWayTargets = new Set([
  'INPUT:value',
  'INPUT:valueAsNumber',
  'INPUT:valueAsDate',
  'INPUT:checked',
  'TEXTAREA:value',
  'SELECT:value',
  'SELECT:selectedIndex'
]);
