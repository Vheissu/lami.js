import type {
  AccessKeyedNode,
  AccessMemberNode,
  AssignmentNode,
  BehaviorCall,
  BindingBehaviorNode,
  Expression,
  ExpressionNode,
  ExpressionOptions,
  ValueConverterNode
} from './ast.js';
import { parseExpressionAst } from './parser.js';
import { getIdentifier, Scope, setIdentifier } from './scope.js';
import { globalResources } from '../resources/registry.js';
import { LamiError, reportWarning } from '../util/errors.js';

export function parseExpression(source: string, options: ExpressionOptions = {}): Expression {
  const ast = parseExpressionAst(source);
  return new RuntimeExpression(source, ast, options);
}

export function evaluateNode(node: ExpressionNode, scope: Scope, options: ExpressionOptions = {}): unknown {
  switch (node.type) {
    case 'Literal':
      return node.value;

    case 'Identifier':
      return getIdentifier(scope, node.name);

    case 'AccessMember': {
      const object = evaluateNode(node.object, scope, options);
      if (object == null) {
        if (node.optional) return undefined;
        throw new LamiError('E_EXPR_PARSE', `Cannot read ${node.name} from nullish value`);
      }
      return (object as Record<string, unknown>)[node.name];
    }

    case 'AccessKeyed': {
      const object = evaluateNode(node.object, scope, options);
      if (object == null) {
        if (node.optional) return undefined;
        throw new LamiError('E_EXPR_PARSE', 'Cannot read keyed property from nullish value');
      }
      const key = evaluateNode(node.key, scope, options) as PropertyKey;
      return (object as Record<PropertyKey, unknown>)[key];
    }

    case 'CallMember': {
      const object = evaluateNode(node.object, scope, options);
      if (object == null) {
        if (node.optional) return undefined;
        throw new LamiError('E_EXPR_PARSE', `Cannot call ${node.name} on nullish value`);
      }
      const fn = (object as Record<string, unknown>)[node.name];
      if (fn == null && node.optional) return undefined;
      if (typeof fn !== 'function') {
        throw new LamiError('E_EXPR_PARSE', `${node.name} is not callable`);
      }
      return fn.apply(object, node.args.map(arg => evaluateNode(arg, scope, options)));
    }

    case 'CallFunction': {
      const call = evaluateCallable(node.callee, scope, options);
      if (call.fn == null && node.optional) return undefined;
      if (typeof call.fn !== 'function') {
        throw new LamiError('E_EXPR_PARSE', 'Expression is not callable');
      }
      return call.fn.apply(call.thisArg, node.args.map(arg => evaluateNode(arg, scope, options)));
    }

    case 'Unary': {
      const value = evaluateNode(node.expression, scope, options);
      switch (node.operator) {
        case '!': return !value;
        case '-': return -(value as number);
        case '+': return +(value as number);
        case 'typeof': return typeof value;
      }
    }

    case 'Binary':
      return evaluateBinary(node.operator, node.left, node.right, scope, options);

    case 'Conditional':
      return evaluateNode(node.test, scope, options)
        ? evaluateNode(node.consequent, scope, options)
        : evaluateNode(node.alternate, scope, options);

    case 'Assignment':
      return evaluateAssignment(node, scope, options);

    case 'ArrayLiteral':
      return node.elements.map(element => evaluateNode(element, scope, options));

    case 'ObjectLiteral': {
      const object: Record<PropertyKey, unknown> = {};
      for (const property of node.properties) {
        const key = typeof property.key === 'string'
          ? property.key
          : evaluateNode(property.key, scope, options) as PropertyKey;
        object[key] = evaluateNode(property.value, scope, options);
      }
      return object;
    }

    case 'ArrowFunction':
      return (...args: unknown[]) => {
        const locals: Record<string, unknown> = Object.create(null);
        node.params.forEach((param, index) => {
          locals[param] = args[index];
        });
        return evaluateNode(node.body, scope.withLocals(locals), options);
      };

    case 'ValueConverter':
      return evaluateConverter(node, scope, options);

    case 'BindingBehavior':
      return evaluateNode(node.expression, scope, options);
  }
}

export function assignToNode(node: ExpressionNode, scope: Scope, value: unknown, options: ExpressionOptions = {}): void {
  switch (node.type) {
    case 'Identifier':
      setIdentifier(scope, node.name, value);
      return;

    case 'AccessMember': {
      const object = evaluateNode(node.object, scope, options);
      if (object == null) throw new LamiError('E_EXPR_ASSIGN', `Cannot assign ${node.name} on nullish value`);
      (object as Record<string, unknown>)[node.name] = value;
      return;
    }

    case 'AccessKeyed': {
      const object = evaluateNode(node.object, scope, options);
      const key = evaluateNode(node.key, scope, options);
      if (object == null) throw new LamiError('E_EXPR_ASSIGN', 'Cannot assign keyed value on nullish value');
      (object as Record<PropertyKey, unknown>)[key as PropertyKey] = value;
      return;
    }

    case 'ValueConverter':
      assignToNode(unwrapConverters(node), scope, applyConvertersFromView(node, scope, value, options), options);
      return;

    case 'BindingBehavior':
      assignToNode(node.expression, scope, value, options);
      return;

    default:
      throw new LamiError('E_EXPR_ASSIGN', 'Expression is not assignable');
  }
}

export function hasAssignment(node: ExpressionNode): boolean {
  switch (node.type) {
    case 'Assignment':
      return true;
    case 'AccessMember':
      return hasAssignment(node.object);
    case 'AccessKeyed':
      return hasAssignment(node.object) || hasAssignment(node.key);
    case 'CallMember':
      return hasAssignment(node.object) || node.args.some(hasAssignment);
    case 'CallFunction':
      return hasAssignment(node.callee) || node.args.some(hasAssignment);
    case 'Unary':
      return hasAssignment(node.expression);
    case 'Binary':
      return hasAssignment(node.left) || hasAssignment(node.right);
    case 'Conditional':
      return hasAssignment(node.test) || hasAssignment(node.consequent) || hasAssignment(node.alternate);
    case 'ArrayLiteral':
      return node.elements.some(hasAssignment);
    case 'ObjectLiteral':
      return node.properties.some(property => hasAssignment(property.value) || (typeof property.key !== 'string' && hasAssignment(property.key)));
    case 'ArrowFunction':
      return hasAssignment(node.body);
    case 'ValueConverter':
    case 'BindingBehavior':
      return hasAssignment(node.expression) || node.args.some(hasAssignment);
    default:
      return false;
  }
}

export function collectBehaviorCalls(node: ExpressionNode): BehaviorCall[] {
  const calls: BehaviorCall[] = [];
  let cursor = node;
  while (cursor.type === 'BindingBehavior') {
    calls.push({ name: cursor.name, args: cursor.args });
    cursor = cursor.expression;
  }
  calls.reverse();
  return calls;
}

export function unwrapBehaviors(node: ExpressionNode): ExpressionNode {
  let cursor = node;
  while (cursor.type === 'BindingBehavior') {
    cursor = cursor.expression;
  }
  return cursor;
}

class RuntimeExpression implements Expression {
  constructor(
    public readonly source: string,
    public readonly ast: ExpressionNode,
    private readonly options: ExpressionOptions
  ) {}

  evaluate(scope: Scope): unknown {
    return evaluateNode(this.ast, scope, this.options);
  }

  assign(scope: Scope, value: unknown): void {
    assignToNode(this.ast, scope, value, this.options);
  }
}

function evaluateBinary(
  operator: string,
  leftNode: ExpressionNode,
  rightNode: ExpressionNode,
  scope: Scope,
  options: ExpressionOptions
): unknown {
  switch (operator) {
    case '&&': {
      const left = evaluateNode(leftNode, scope, options);
      return left ? evaluateNode(rightNode, scope, options) : left;
    }
    case '||': {
      const left = evaluateNode(leftNode, scope, options);
      return left ? left : evaluateNode(rightNode, scope, options);
    }
    case '??': {
      const left = evaluateNode(leftNode, scope, options);
      return left ?? evaluateNode(rightNode, scope, options);
    }
  }

  const left = evaluateNode(leftNode, scope, options);
  const right = evaluateNode(rightNode, scope, options);

  switch (operator) {
    case '==': return left == right;
    case '!=': return left != right;
    case '===': return left === right;
    case '!==': return left !== right;
    case '<': return (left as number) < (right as number);
    case '>': return (left as number) > (right as number);
    case '<=': return (left as number) <= (right as number);
    case '>=': return (left as number) >= (right as number);
    case 'in': return (left as PropertyKey) in (right as object);
    case '+': return (left as number) + (right as number);
    case '-': return (left as number) - (right as number);
    case '*': return (left as number) * (right as number);
    case '/': return (left as number) / (right as number);
    case '%': return (left as number) % (right as number);
    default:
      throw new LamiError('E_EXPR_PARSE', `Unsupported operator ${operator}`);
  }
}

function evaluateAssignment(node: AssignmentNode, scope: Scope, options: ExpressionOptions): unknown {
  if (node.operator === '=') {
    const value = evaluateNode(node.value, scope, options);
    assignToNode(node.target, scope, value, options);
    return value;
  }

  const current = evaluateNode(node.target, scope, options);
  if (node.operator === '??=' && current != null) return current;

  const value = evaluateNode(node.value, scope, options);
  let next: unknown;
  switch (node.operator) {
    case '+=': next = (current as number) + (value as number); break;
    case '-=': next = (current as number) - (value as number); break;
    case '*=': next = (current as number) * (value as number); break;
    case '/=': next = (current as number) / (value as number); break;
    case '%=': next = (current as number) % (value as number); break;
    case '??=': next = value; break;
  }

  assignToNode(node.target, scope, next, options);
  return next;
}

function evaluateConverter(node: ValueConverterNode, scope: Scope, options: ExpressionOptions): unknown {
  const converter = options.resources?.getConverter(node.name) ?? globalResources.getConverter(node.name);
  if (!converter) {
    if (options.dev) throw new LamiError('E_RESOURCE_MISSING', `Value converter "${node.name}" is not registered`);
    reportWarning(options, 'W_RESOURCE_MISSING', `Value converter "${node.name}" is not registered`, {
      converter: node.name,
      expression: node.expression.type
    });
    return evaluateNode(node.expression, scope, options);
  }

  const value = evaluateNode(node.expression, scope, options);
  const args = node.args.map(arg => evaluateNode(arg, scope, options));
  return converter.toView(value, ...args);
}

function applyConvertersFromView(node: ValueConverterNode, scope: Scope, value: unknown, options: ExpressionOptions): unknown {
  const chain: ValueConverterNode[] = [];
  let cursor: ExpressionNode = node;
  while (cursor.type === 'ValueConverter') {
    chain.push(cursor);
    cursor = cursor.expression;
  }

  let next = value;
  for (const converterNode of chain) {
    const converter = options.resources?.getConverter(converterNode.name) ?? globalResources.getConverter(converterNode.name);
    if (!converter?.fromView) continue;
    const args = converterNode.args.map(arg => evaluateNode(arg, scope, options));
    next = converter.fromView(next, ...args);
  }
  return next;
}

function unwrapConverters(node: ValueConverterNode): ExpressionNode {
  let cursor: ExpressionNode = node;
  while (cursor.type === 'ValueConverter') {
    cursor = cursor.expression;
  }
  return cursor;
}

function evaluateCallable(
  node: ExpressionNode,
  scope: Scope,
  options: ExpressionOptions
): { fn: unknown; thisArg: unknown } {
  if (node.type === 'Identifier') {
    return {
      fn: getIdentifier(scope, node.name),
      thisArg: scope.bindingContext
    };
  }

  if (node.type === 'AccessMember') {
    const object = evaluateNode(node.object, scope, options);
    if (object == null) return { fn: undefined, thisArg: undefined };
    return {
      fn: (object as Record<string, unknown>)[node.name],
      thisArg: object
    };
  }

  if (node.type === 'AccessKeyed') {
    const object = evaluateNode(node.object, scope, options);
    if (object == null) return { fn: undefined, thisArg: undefined };
    const key = evaluateNode(node.key, scope, options) as PropertyKey;
    return {
      fn: (object as Record<PropertyKey, unknown>)[key],
      thisArg: object
    };
  }

  return { fn: evaluateNode(node, scope, options), thisArg: undefined };
}
