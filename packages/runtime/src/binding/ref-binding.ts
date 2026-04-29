import type { Scope } from '../expression/scope.js';
import { markRaw, raw } from '../reactivity/reactive.js';
import { BindingController, BindingMode } from './binding.js';

export class RefBinding extends BindingController {
  private assigned: unknown;

  constructor(
    id: number,
    private readonly property: string,
    private readonly value: unknown,
    private readonly scope: Scope
  ) {
    super(id, BindingMode.oneTime);
  }

  bind(): void {
    this.assigned = typeof this.value === 'object' && this.value !== null
      ? markRaw(this.value)
      : this.value;
    (this.scope.bindingContext as Record<string, unknown>)[this.property] = this.assigned;
  }

  refresh(): void {}

  override unbind(): void {
    if (raw((this.scope.bindingContext as Record<string, unknown>)[this.property]) === raw(this.assigned)) {
      (this.scope.bindingContext as Record<string, unknown>)[this.property] = undefined;
    }
    super.unbind();
  }
}
