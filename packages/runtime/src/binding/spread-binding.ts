import type { Expression } from '../expression/ast.js';
import type { Scope } from '../expression/scope.js';
import { BindingController, BindingMode } from './binding.js';
import { writeAttribute, writeProperty } from './target-observer.js';

export class SpreadBinding extends BindingController {
  private previousKeys = new Set<string>();

  constructor(
    id: number,
    private readonly element: Element,
    private readonly expression: Expression,
    private readonly scope: Scope
  ) {
    super(id, BindingMode.toView);
  }

  bind(): void {
    this.runEffect(() => this.refresh());
  }

  refresh(): void {
    const value = this.expression.evaluate(this.scope);
    const next = value && typeof value === 'object'
      ? value as Record<string, unknown>
      : {};
    const nextKeys = new Set(Object.keys(next));

    for (const key of this.previousKeys) {
      if (!nextKeys.has(key)) this.write(key, null);
    }

    for (const key of nextKeys) {
      this.write(key, next[key]);
    }

    this.previousKeys = nextKeys;
  }

  private write(key: string, value: unknown): void {
    if (key.startsWith('data-') || key.startsWith('aria-')) {
      writeAttribute(this.element, key, value);
      return;
    }

    writeProperty(this.element, key, value);
  }
}
