import type { Expression } from '../expression/ast.js';
import type { Scope } from '../expression/scope.js';
import { BindingController, BindingMode } from '../binding/binding.js';
import type { View, ViewFactory } from './view.js';

export interface PromiseBranches {
  pending?: ViewFactory;
  then?: {
    local: string;
    factory: ViewFactory;
  };
  catch?: {
    local: string;
    factory: ViewFactory;
  };
}

export class PromiseController extends BindingController {
  private activeView: View | undefined;
  private token = 0;

  constructor(
    id: number,
    private readonly expression: Expression,
    private readonly scope: Scope,
    private readonly branches: PromiseBranches,
    private readonly location: Comment
  ) {
    super(id, BindingMode.toView);
  }

  bind(): void {
    this.runEffect(() => this.refresh());
  }

  refresh(): void {
    const token = ++this.token;
    const value = this.expression.evaluate(this.scope);

    if (!isPromiseLike(value)) {
      this.renderThen(value);
      return;
    }

    this.renderPending();
    value.then(
      result => {
        if (token === this.token) this.renderThen(result);
      },
      error => {
        if (token === this.token) this.renderCatch(error);
      }
    );
  }

  override unbind(): void {
    this.token++;
    this.activeView?.unbind();
    this.activeView?.remove();
    this.activeView = undefined;
    super.unbind();
  }

  private renderPending(): void {
    this.render(this.branches.pending?.create(this.scope));
  }

  private renderThen(value: unknown): void {
    if (!this.branches.then) {
      this.render(undefined);
      return;
    }

    this.render(this.branches.then.factory.create(
      this.scope.withLocal(this.branches.then.local, value)
    ));
  }

  private renderCatch(error: unknown): void {
    if (!this.branches.catch) {
      this.render(undefined);
      return;
    }

    this.render(this.branches.catch.factory.create(
      this.scope.withLocal(this.branches.catch.local, error)
    ));
  }

  private render(view: View | undefined): void {
    this.activeView?.unbind();
    this.activeView?.remove();
    this.activeView = view;

    if (!this.activeView) return;
    this.activeView.moveBefore(this.location);
    this.activeView.bind();
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function';
}
