import type { Expression } from '../expression/ast.js';
import type { Scope } from '../expression/scope.js';
import { BindingController, BindingMode } from '../binding/binding.js';

export class ShowController extends BindingController {
  private readonly initialDisplay: string;

  constructor(
    id: number,
    private readonly element: HTMLElement,
    private readonly expression: Expression,
    private readonly scope: Scope,
    private readonly invert = false
  ) {
    super(id, BindingMode.toView);
    this.initialDisplay = element.style.display;
  }

  bind(): void {
    this.runEffect(() => this.refresh());
  }

  refresh(): void {
    const visible = !!this.expression.evaluate(this.scope);
    this.element.style.display = (this.invert ? !visible : visible)
      ? this.initialDisplay
      : 'none';
  }
}
