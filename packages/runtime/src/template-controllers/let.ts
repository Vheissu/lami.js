import type { Expression } from '../expression/ast.js';
import type { Scope } from '../expression/scope.js';
import { BindingController, BindingMode } from '../binding/binding.js';

export class LetBinding extends BindingController {
  constructor(
    id: number,
    private readonly property: string,
    private readonly expression: Expression,
    private readonly scope: Scope,
    private readonly toBindingContext: boolean
  ) {
    super(id, BindingMode.toView);
  }

  bind(): void {
    this.runEffect(() => this.refresh());
  }

  refresh(): void {
    const value = this.expression.evaluate(this.scope);
    if (this.toBindingContext) {
      (this.scope.bindingContext as Record<string, unknown>)[this.property] = value;
    } else {
      this.scope.locals[this.property] = value;
    }
  }
}
