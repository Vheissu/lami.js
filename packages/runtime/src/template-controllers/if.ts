import type { Expression } from '../expression/ast.js';
import type { Scope } from '../expression/scope.js';
import { BindingController, BindingMode } from '../binding/binding.js';
import type { View, ViewFactory } from './view.js';

export class IfController extends BindingController {
  private active: 'if' | 'else' | null = null;
  private ifView: View | undefined;
  private elseView: View | undefined;

  constructor(
    id: number,
    private readonly expression: Expression,
    private readonly scope: Scope,
    private readonly ifFactory: ViewFactory,
    private readonly elseFactory: ViewFactory | null,
    private readonly location: Comment,
    private readonly cache = false
  ) {
    super(id, BindingMode.toView);
  }

  bind(): void {
    this.runEffect(() => this.refresh());
  }

  refresh(): void {
    const next = !!this.expression.evaluate(this.scope) ? 'if' : 'else';
    if (next === this.active) {
      const activeView = this.active === 'if' ? this.ifView : this.elseView;
      activeView?.refresh();
      return;
    }

    this.deactivateCurrent();

    if (next === 'if') {
      this.ifView ??= this.ifFactory.create(this.scope);
      this.ifView.moveBefore(this.location);
      this.ifView.bind();
    } else if (this.elseFactory) {
      this.elseView ??= this.elseFactory.create(this.scope);
      this.elseView.moveBefore(this.location);
      this.elseView.bind();
    }

    this.active = next;
  }

  override unbind(): void {
    this.deactivateCurrent();
    this.ifView?.unbind();
    this.elseView?.unbind();
    super.unbind();
  }

  private deactivateCurrent(): void {
    const view = this.active === 'if' ? this.ifView : this.elseView;
    if (!view) return;

    view.unbind();
    view.remove();

    if (!this.cache) {
      if (this.active === 'if') this.ifView = undefined;
      if (this.active === 'else') this.elseView = undefined;
    }
  }
}
