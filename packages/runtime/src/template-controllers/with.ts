import type { Expression } from '../expression/ast.js';
import type { Scope } from '../expression/scope.js';
import { reactive } from '../reactivity/reactive.js';
import { BindingController, BindingMode } from '../binding/binding.js';
import type { View, ViewFactory } from './view.js';

export class WithController extends BindingController {
  private activeView: View | undefined;
  private activeContext: unknown;

  constructor(
    id: number,
    private readonly expression: Expression,
    private readonly scope: Scope,
    private readonly factory: ViewFactory,
    private readonly location: Comment
  ) {
    super(id, BindingMode.toView);
  }

  bind(): void {
    this.runEffect(() => this.refresh());
  }

  refresh(): void {
    const context = this.expression.evaluate(this.scope) ?? {};
    if (Object.is(context, this.activeContext)) return;

    this.activeView?.unbind();
    this.activeView?.remove();
    this.activeContext = context;

    const childContext = typeof context === 'object' && context !== null
      ? reactive(context)
      : {};
    this.activeView = this.factory.create(this.scope.withContext(childContext));
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
