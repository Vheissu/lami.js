import type { Expression } from '../expression/ast.js';
import type { Scope } from '../expression/scope.js';
import type { InterpolationPart } from '../compiler-runtime/interpolation.js';
import { BindingController, BindingMode } from './binding.js';
import type { TargetObserver } from './target-observer.js';
import type { BindingBehavior } from '../resources/registry.js';
import { bindBehaviors, unbindBehaviors, wrapFromView } from './behaviors.js';
import { ValueSlot } from '../util/equality.js';

export class PropertyBinding extends BindingController {
  private readonly targetSlot = new ValueSlot<unknown>();

  constructor(
    id: number,
    mode: BindingMode,
    private readonly source: Expression,
    private readonly target: TargetObserver,
    private readonly scope: Scope,
    private readonly behaviors: BindingBehavior[] = []
  ) {
    super(id, mode);
  }

  bind(): void {
    bindBehaviors(this.behaviors, this, this.scope);

    if (this.mode === BindingMode.oneTime) {
      this.runWithDiagnostics('updateTarget', () => this.updateTarget(), {
        expression: this.source.source
      });
      return;
    }

    if (this.mode === BindingMode.toView || this.mode === BindingMode.twoWay) {
      this.runEffect(() => this.updateTarget(), 'updateTarget');
    }

    if (this.mode === BindingMode.fromView || this.mode === BindingMode.twoWay) {
      const update = wrapFromView(this.behaviors, () => {
        this.runWithDiagnostics('updateSource', () => this.updateSource(), {
          expression: this.source.source
        });
      }, this.scope);
      const cleanup = this.target.subscribe(() => update(this.target.read()));
      this.onDispose(cleanup);
    }
  }

  refresh(): void {
    if (this.mode !== BindingMode.fromView) this.updateTarget();
  }

  override unbind(): void {
    unbindBehaviors(this.behaviors, this);
    super.unbind();
  }

  private updateTarget(): void {
    const value = this.source.evaluate(this.scope);
    if (this.targetSlot.shouldWrite(value)) {
      this.target.write(value);
    }
  }

  private updateSource(): void {
    if (!this.source.assign) {
      throw new Error('Cannot assign to expression');
    }

    const currentSourceValue = this.source.evaluate(this.scope);
    const sourceValue = this.target.readForSource
      ? this.target.readForSource(currentSourceValue)
      : this.target.read();
    this.source.assign(this.scope, sourceValue);
    this.targetSlot.remember(sourceValue);
  }
}

export class InterpolationBinding extends BindingController {
  private readonly targetSlot = new ValueSlot<string>();

  constructor(
    id: number,
    private readonly parts: InterpolationPart[],
    private readonly write: (value: string) => void,
    private readonly scope: Scope
  ) {
    super(id, BindingMode.toView);
  }

  bind(): void {
    this.runEffect(() => this.refresh());
  }

  refresh(): void {
    const value = this.parts
      .map(part => part.type === 'text' ? part.value : stringify(part.expression.evaluate(this.scope)))
      .join('');
    if (this.targetSlot.shouldWrite(value)) {
      this.write(value);
    }
  }
}

function stringify(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}
