import { parseExpression, type ExpressionNode } from '@lami.js/runtime';

export interface CompiledExpressionEmitOptions {
  localNames?: ReadonlySet<string>;
}

export function emitCompiledExpression(source: string, options: CompiledExpressionEmitOptions = {}): string {
  const expression = parseExpression(source);
  if (!canEmitExpression(expression.ast)) return JSON.stringify(source);

  const assign = canAssign(expression.ast)
    ? `, assign(scope, value) { ${emitAssign(expression.ast, 'value', options)} }`
    : '';
  return `{ source: ${JSON.stringify(source)}, evaluate(scope) { return ${emitNode(expression.ast, options)}; }${assign} }`;
}

export function canEmitCompiledExpression(source: string): boolean {
  return canEmitExpression(parseExpression(source).ast);
}

export function canAssignCompiledExpression(source: string): boolean {
  return canAssign(parseExpression(source).ast);
}

export function collectCompiledExpressionIdentifiers(source: string): ReadonlySet<string> {
  const identifiers = new Set<string>();
  collectIdentifiers(parseExpression(source).ast, identifiers);
  return identifiers;
}

function canEmitExpression(node: ExpressionNode): boolean {
  switch (node.type) {
    case 'Literal':
    case 'Identifier':
      return true;
    case 'AccessMember':
      return canEmitExpression(node.object);
    case 'AccessKeyed':
      return canEmitExpression(node.object) && canEmitExpression(node.key);
    case 'CallMember':
      return canEmitExpression(node.object) && node.args.every(canEmitExpression);
    case 'CallFunction':
      return canEmitExpression(node.callee) && node.args.every(canEmitExpression);
    case 'Unary':
      return canEmitExpression(node.expression);
    case 'Binary':
      return canEmitExpression(node.left) && canEmitExpression(node.right);
    case 'Conditional':
      return canEmitExpression(node.test) && canEmitExpression(node.consequent) && canEmitExpression(node.alternate);
    case 'ArrayLiteral':
      return node.elements.every(canEmitExpression);
    case 'ObjectLiteral':
      return node.properties.every(property =>
        canEmitExpression(property.value) &&
        (typeof property.key === 'string' || canEmitExpression(property.key))
      );
    case 'Assignment':
    case 'ArrowFunction':
    case 'ValueConverter':
    case 'BindingBehavior':
      return false;
  }
}

function collectIdentifiers(node: ExpressionNode, identifiers: Set<string>): void {
  switch (node.type) {
    case 'Literal':
      return;
    case 'Identifier':
      identifiers.add(node.name);
      return;
    case 'AccessMember':
      collectIdentifiers(node.object, identifiers);
      return;
    case 'AccessKeyed':
      collectIdentifiers(node.object, identifiers);
      collectIdentifiers(node.key, identifiers);
      return;
    case 'CallMember':
      collectIdentifiers(node.object, identifiers);
      for (const arg of node.args) collectIdentifiers(arg, identifiers);
      return;
    case 'CallFunction':
      collectIdentifiers(node.callee, identifiers);
      for (const arg of node.args) collectIdentifiers(arg, identifiers);
      return;
    case 'Unary':
      collectIdentifiers(node.expression, identifiers);
      return;
    case 'Binary':
      collectIdentifiers(node.left, identifiers);
      collectIdentifiers(node.right, identifiers);
      return;
    case 'Conditional':
      collectIdentifiers(node.test, identifiers);
      collectIdentifiers(node.consequent, identifiers);
      collectIdentifiers(node.alternate, identifiers);
      return;
    case 'ArrayLiteral':
      for (const element of node.elements) collectIdentifiers(element, identifiers);
      return;
    case 'ObjectLiteral':
      for (const property of node.properties) {
        if (typeof property.key !== 'string') collectIdentifiers(property.key, identifiers);
        collectIdentifiers(property.value, identifiers);
      }
      return;
    case 'Assignment':
      collectIdentifiers(node.target, identifiers);
      collectIdentifiers(node.value, identifiers);
      return;
    case 'ArrowFunction':
      collectIdentifiers(node.body, identifiers);
      return;
    case 'ValueConverter':
    case 'BindingBehavior':
      collectIdentifiers(node.expression, identifiers);
      for (const arg of node.args) collectIdentifiers(arg, identifiers);
      return;
  }
}

function emitNode(node: ExpressionNode, options: CompiledExpressionEmitOptions): string {
  switch (node.type) {
    case 'Literal':
      return literal(node.value);
    case 'Identifier':
      if (options.localNames?.has(node.name)) {
        return `scope.locals[${JSON.stringify(node.name)}]`;
      }
      return `getIdentifier(scope, ${JSON.stringify(node.name)})`;
    case 'AccessMember':
      return node.optional
        ? `(($obj) => $obj == null ? undefined : $obj[${JSON.stringify(node.name)}])(${emitNode(node.object, options)})`
        : `(${emitNode(node.object, options)})[${JSON.stringify(node.name)}]`;
    case 'AccessKeyed':
      return node.optional
        ? `(($obj, $key) => $obj == null ? undefined : $obj[$key])(${emitNode(node.object, options)}, ${emitNode(node.key, options)})`
        : `(${emitNode(node.object, options)})[${emitNode(node.key, options)}]`;
    case 'CallMember': {
      const args = node.args.map(arg => emitNode(arg, options)).join(', ');
      return node.optional
        ? `(($obj) => $obj == null || $obj[${JSON.stringify(node.name)}] == null ? undefined : $obj[${JSON.stringify(node.name)}](${args}))(${emitNode(node.object, options)})`
        : `(${emitNode(node.object, options)})[${JSON.stringify(node.name)}](${args})`;
    }
    case 'CallFunction':
      return emitCallFunction(node.callee, node.args, options);
    case 'Unary':
      return `(${node.operator} ${emitNode(node.expression, options)})`;
    case 'Binary':
      return `(${emitNode(node.left, options)} ${node.operator} ${emitNode(node.right, options)})`;
    case 'Conditional':
      return `(${emitNode(node.test, options)} ? ${emitNode(node.consequent, options)} : ${emitNode(node.alternate, options)})`;
    case 'ArrayLiteral':
      return `[${node.elements.map(element => emitNode(element, options)).join(', ')}]`;
    case 'ObjectLiteral':
      return `{ ${node.properties.map(property => `${emitObjectKey(property.key, options)}: ${emitNode(property.value, options)}`).join(', ')} }`;
    case 'Assignment':
    case 'ArrowFunction':
    case 'ValueConverter':
    case 'BindingBehavior':
      throw new Error(`Expression node ${node.type} is not supported by direct expression codegen`);
  }
}

function emitCallFunction(callee: ExpressionNode, args: ExpressionNode[], options: CompiledExpressionEmitOptions): string {
  const argList = args.map(arg => emitNode(arg, options)).join(', ');
  if (callee.type === 'Identifier') {
    return `(($fn) => $fn == null ? undefined : $fn.call(scope.bindingContext${argList ? `, ${argList}` : ''}))(${emitNode(callee, options)})`;
  }
  return `(${emitNode(callee, options)})(${argList})`;
}

function canAssign(node: ExpressionNode): boolean {
  switch (node.type) {
    case 'Identifier':
      return true;
    case 'AccessMember':
      return !node.optional && canEmitExpression(node.object);
    case 'AccessKeyed':
      return !node.optional && canEmitExpression(node.object) && canEmitExpression(node.key);
    default:
      return false;
  }
}

function emitAssign(node: ExpressionNode, value: string, options: CompiledExpressionEmitOptions): string {
  switch (node.type) {
    case 'Identifier':
      if (options.localNames?.has(node.name)) {
        return `scope.locals[${JSON.stringify(node.name)}] = ${value};`;
      }
      return `setIdentifier(scope, ${JSON.stringify(node.name)}, ${value});`;
    case 'AccessMember':
      return `(${emitNode(node.object, options)})[${JSON.stringify(node.name)}] = ${value};`;
    case 'AccessKeyed':
      return `(${emitNode(node.object, options)})[${emitNode(node.key, options)}] = ${value};`;
    default:
      throw new Error(`Expression node ${node.type} is not assignable`);
  }
}

function emitObjectKey(key: string | ExpressionNode, options: CompiledExpressionEmitOptions): string {
  return typeof key === 'string'
    ? JSON.stringify(key)
    : `[${emitNode(key, options)}]`;
}

function literal(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}
