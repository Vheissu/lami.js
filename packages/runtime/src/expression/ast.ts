import type { Scope } from './scope.js';
import type { ResourceRegistry } from '../resources/registry.js';
import type { ErrorReporter } from '../util/errors.js';

export type ExpressionNode =
  | LiteralNode
  | IdentifierNode
  | AccessMemberNode
  | AccessKeyedNode
  | CallMemberNode
  | CallFunctionNode
  | UnaryNode
  | BinaryNode
  | ConditionalNode
  | AssignmentNode
  | ArrayLiteralNode
  | ObjectLiteralNode
  | ArrowFunctionNode
  | ValueConverterNode
  | BindingBehaviorNode;

export interface LiteralNode {
  type: 'Literal';
  value: unknown;
}

export interface IdentifierNode {
  type: 'Identifier';
  name: string;
}

export interface AccessMemberNode {
  type: 'AccessMember';
  object: ExpressionNode;
  name: string;
  optional?: boolean;
}

export interface AccessKeyedNode {
  type: 'AccessKeyed';
  object: ExpressionNode;
  key: ExpressionNode;
  optional?: boolean;
}

export interface CallMemberNode {
  type: 'CallMember';
  object: ExpressionNode;
  name: string;
  args: ExpressionNode[];
  optional?: boolean;
}

export interface CallFunctionNode {
  type: 'CallFunction';
  callee: ExpressionNode;
  args: ExpressionNode[];
  optional?: boolean;
}

export interface UnaryNode {
  type: 'Unary';
  operator: '!' | '-' | '+' | 'typeof';
  expression: ExpressionNode;
}

export interface BinaryNode {
  type: 'Binary';
  operator:
    | '??'
    | '||'
    | '&&'
    | '=='
    | '!='
    | '==='
    | '!=='
    | '<'
    | '>'
    | '<='
    | '>='
    | 'in'
    | '+'
    | '-'
    | '*'
    | '/'
    | '%';
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface ConditionalNode {
  type: 'Conditional';
  test: ExpressionNode;
  consequent: ExpressionNode;
  alternate: ExpressionNode;
}

export interface AssignmentNode {
  type: 'Assignment';
  operator: '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '??=';
  target: ExpressionNode;
  value: ExpressionNode;
}

export interface ArrayLiteralNode {
  type: 'ArrayLiteral';
  elements: ExpressionNode[];
}

export interface ObjectLiteralNode {
  type: 'ObjectLiteral';
  properties: Array<{
    key: string | ExpressionNode;
    value: ExpressionNode;
    shorthand?: boolean;
  }>;
}

export interface ArrowFunctionNode {
  type: 'ArrowFunction';
  params: string[];
  body: ExpressionNode;
}

export interface ValueConverterNode {
  type: 'ValueConverter';
  expression: ExpressionNode;
  name: string;
  args: ExpressionNode[];
}

export interface BindingBehaviorNode {
  type: 'BindingBehavior';
  expression: ExpressionNode;
  name: string;
  args: ExpressionNode[];
}

export interface DependencyDescriptor {
  name?: string;
  target?: object;
  key?: PropertyKey;
}

export interface Expression {
  readonly source: string;
  readonly ast: ExpressionNode;
  evaluate(scope: Scope): unknown;
  assign?(scope: Scope, value: unknown): void;
  dependencies?(scope: Scope): DependencyDescriptor[];
}

export interface ExpressionOptions extends ErrorReporter {
  resources?: ResourceRegistry;
}

export interface BehaviorCall {
  name: string;
  args: ExpressionNode[];
}
