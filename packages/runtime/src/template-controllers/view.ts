import type { Scope } from '../expression/scope.js';

export interface View {
  readonly first: Node;
  readonly last: Node;
  readonly scope: Scope;
  bind(): void;
  refresh(): void;
  unbind(): void;
  remove(): void;
  moveBefore(reference: Node): void;
  appendTo?(parent: Node): void;
  updateLocals?(locals: Record<string, unknown>): void;
}

export interface ViewFactory {
  create(scope: Scope): View;
}
