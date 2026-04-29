import type { Expression } from '../expression/ast.js';
import type { Scope } from '../expression/scope.js';
import { BindingController, BindingMode } from '../binding/binding.js';
import type { View, ViewFactory } from './view.js';

export interface SwitchCase {
  factory: ViewFactory;
  matches(value: unknown, scope: Scope): boolean;
}

export class SwitchController extends BindingController {
  private activeIndex = -1;
  private activeView: View | undefined;

  constructor(
    id: number,
    private readonly expression: Expression,
    private readonly scope: Scope,
    private readonly cases: SwitchCase[],
    private readonly defaultCase: SwitchCase | null,
    private readonly location: Comment
  ) {
    super(id, BindingMode.toView);
  }

  bind(): void {
    this.runEffect(() => this.refresh());
  }

  refresh(): void {
    const value = this.expression.evaluate(this.scope);
    const nextIndex = this.cases.findIndex(entry => entry.matches(value, this.scope));
    const selectedIndex = nextIndex === -1 && this.defaultCase ? this.cases.length : nextIndex;
    if (selectedIndex === this.activeIndex) return;

    this.activeView?.unbind();
    this.activeView?.remove();
    this.activeView = undefined;
    this.activeIndex = selectedIndex;

    const selected = selectedIndex === this.cases.length
      ? this.defaultCase
      : this.cases[selectedIndex];
    if (!selected) return;

    this.activeView = selected.factory.create(this.scope);
    this.activeView.moveBefore(this.location);
    this.activeView.bind();
  }

  override unbind(): void {
    this.activeView?.unbind();
    this.activeView?.remove();
    this.activeView = undefined;
    super.unbind();
  }
}
