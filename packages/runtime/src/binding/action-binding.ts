import type { Expression } from '../expression/ast.js';
import type { Scope } from '../expression/scope.js';
import type { ActionController, ActionResult, ResourceRegistry } from '../resources/registry.js';
import { ValueSlot } from '../util/equality.js';
import { BindingController, BindingMode } from './binding.js';

export class ActionBinding extends BindingController {
  private readonly valueSlot = new ValueSlot<unknown>();
  private initialized = false;
  private controller: ActionController | undefined;
  private cleanup: (() => void) | undefined;

  constructor(
    id: number,
    private readonly element: Element,
    private readonly name: string,
    private readonly source: Expression,
    private readonly scope: Scope,
    private readonly resources: ResourceRegistry
  ) {
    super(id, BindingMode.toView);
  }

  bind(): void {
    this.onDispose(() => this.stop());
    this.runEffect(() => this.refresh(), 'action');
  }

  refresh(): void {
    const value = this.source.evaluate(this.scope);
    if (!this.initialized) {
      this.initialized = true;
      this.valueSlot.remember(value);
      this.start(value);
      return;
    }

    if (!this.valueSlot.shouldWrite(value)) return;
    this.controller?.update?.(value, this.scope);
  }

  private stop(): void {
    try {
      this.controller?.destroy?.();
      this.cleanup?.();
    } finally {
      this.controller = undefined;
      this.cleanup = undefined;
      this.initialized = false;
    }
  }

  private start(value: unknown): void {
    const action = this.resources.getAction(this.name);
    if (!action) {
      throw new Error(`Action "${this.name}" is not registered`);
    }

    this.install(action(this.element, value, this.scope));
  }

  private install(result: ActionResult): void {
    if (typeof result === 'function') {
      this.cleanup = result;
      return;
    }

    if (result && typeof result === 'object') {
      this.controller = result;
    }
  }
}
