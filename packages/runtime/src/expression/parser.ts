import type {
  ArrayLiteralNode,
  ArrowFunctionNode,
  AssignmentNode,
  BinaryNode,
  ExpressionNode,
  ObjectLiteralNode
} from './ast.js';
import { tokenize, type Token } from './lexer.js';
import { LamiError } from '../util/errors.js';

const assignmentOperators = new Set(['=', '+=', '-=', '*=', '/=', '%=', '??=']);
const binaryPrecedence = new Map<string, number>([
  ['??', 1],
  ['||', 2],
  ['&&', 3],
  ['==', 4],
  ['!=', 4],
  ['===', 4],
  ['!==', 4],
  ['<', 5],
  ['>', 5],
  ['<=', 5],
  ['>=', 5],
  ['in', 5],
  ['+', 6],
  ['-', 6],
  ['*', 7],
  ['/', 7],
  ['%', 7]
]);

export function parseExpressionAst(source: string): ExpressionNode {
  const parser = new Parser(source);
  return parser.parse();
}

class Parser {
  private readonly tokens: Token[];
  private position = 0;

  constructor(private readonly source: string) {
    this.tokens = tokenize(source);
  }

  parse(): ExpressionNode {
    const expression = this.parseBindingExpression();
    this.expectEof();
    return expression;
  }

  private parseBindingExpression(): ExpressionNode {
    let expression = this.parseConverterExpression();
    while (this.matchPunctuator('&')) {
      const name = this.expectIdentifier('Expected binding behavior name after &');
      const args = this.parseColonArguments();
      expression = { type: 'BindingBehavior', expression, name, args };
    }
    return expression;
  }

  private parseConverterExpression(): ExpressionNode {
    let expression = this.parseAssignment();
    while (this.matchPunctuator('|')) {
      const name = this.expectIdentifier('Expected value converter name after |');
      const args = this.parseColonArguments();
      expression = { type: 'ValueConverter', expression, name, args };
    }
    return expression;
  }

  private parseColonArguments(): ExpressionNode[] {
    const args: ExpressionNode[] = [];
    while (this.matchPunctuator(':')) {
      args.push(this.parseAssignment());
    }
    return args;
  }

  private parseAssignment(): ExpressionNode {
    const target = this.parseConditional();
    const token = this.peek();
    if (token.kind === 'punctuator' && assignmentOperators.has(token.value)) {
      this.advance();
      return {
        type: 'Assignment',
        operator: token.value as AssignmentNode['operator'],
        target,
        value: this.parseAssignment()
      };
    }
    return target;
  }

  private parseConditional(): ExpressionNode {
    const test = this.parseBinary(0);
    if (!this.matchPunctuator('?')) return test;

    const consequent = this.parseAssignment();
    this.expectPunctuator(':', 'Expected : in conditional expression');
    const alternate = this.parseAssignment();
    return { type: 'Conditional', test, consequent, alternate };
  }

  private parseBinary(minPrecedence: number): ExpressionNode {
    let left = this.parseUnary();

    while (true) {
      const operator = this.currentBinaryOperator();
      if (!operator) break;

      const precedence = binaryPrecedence.get(operator)!;
      if (precedence < minPrecedence) break;

      this.advance();
      const right = this.parseBinary(precedence + 1);
      left = { type: 'Binary', operator: operator as BinaryNode['operator'], left, right };
    }

    return left;
  }

  private parseUnary(): ExpressionNode {
    const token = this.peek();
    if (
      (token.kind === 'punctuator' && (token.value === '!' || token.value === '-' || token.value === '+')) ||
      (token.kind === 'identifier' && token.value === 'typeof')
    ) {
      this.advance();
      return {
        type: 'Unary',
        operator: token.value as '!' | '-' | '+' | 'typeof',
        expression: this.parseUnary()
      };
    }

    return this.parseCallExpression();
  }

  private parseCallExpression(): ExpressionNode {
    let expression = this.parsePrimary();

    while (true) {
      if (this.matchPunctuator('.')) {
        const name = this.expectIdentifier('Expected property name after .');
        expression = { type: 'AccessMember', object: expression, name };
        continue;
      }

      if (this.matchPunctuator('?.')) {
        if (this.matchPunctuator('(')) {
          expression = { type: 'CallFunction', callee: expression, args: this.parseArgumentList(')'), optional: true };
          continue;
        }

        if (this.matchPunctuator('[')) {
          const key = this.parseBindingExpression();
          this.expectPunctuator(']', 'Expected ] after optional keyed access');
          expression = { type: 'AccessKeyed', object: expression, key, optional: true };
          continue;
        }

        const name = this.expectIdentifier('Expected property name after ?.');
        expression = { type: 'AccessMember', object: expression, name, optional: true };
        continue;
      }

      if (this.matchPunctuator('[')) {
        const key = this.parseBindingExpression();
        this.expectPunctuator(']', 'Expected ] after keyed access');
        expression = { type: 'AccessKeyed', object: expression, key };
        continue;
      }

      if (this.matchPunctuator('(')) {
        const args = this.parseArgumentList(')');
        if (expression.type === 'AccessMember') {
          const next: ExpressionNode = expression.optional === undefined
            ? {
                type: 'CallMember',
                object: expression.object,
                name: expression.name,
                args
              }
            : {
                type: 'CallMember',
                object: expression.object,
                name: expression.name,
                args,
                optional: expression.optional
              };
          expression = {
            ...next
          };
        } else {
          expression = { type: 'CallFunction', callee: expression, args };
        }
        continue;
      }

      break;
    }

    return expression;
  }

  private parsePrimary(): ExpressionNode {
    const token = this.peek();

    if (token.kind === 'identifier' && this.peek(1).value === '=>') {
      const name = token.value;
      this.advance();
      this.advance();
      return { type: 'ArrowFunction', params: [name], body: this.parseAssignment() };
    }

    if (this.matchPunctuator('(')) {
      const arrowParams = this.tryParseParenthesizedArrow();
      if (arrowParams) return arrowParams;

      const expression = this.parseBindingExpression();
      this.expectPunctuator(')', 'Expected ) after parenthesized expression');
      return expression;
    }

    if (token.kind === 'number') {
      this.advance();
      return { type: 'Literal', value: Number(token.value) };
    }

    if (token.kind === 'string') {
      this.advance();
      return { type: 'Literal', value: token.value };
    }

    if (token.kind === 'identifier') {
      this.advance();
      switch (token.value) {
        case 'true': return { type: 'Literal', value: true };
        case 'false': return { type: 'Literal', value: false };
        case 'null': return { type: 'Literal', value: null };
        case 'undefined': return { type: 'Literal', value: undefined };
        default: return { type: 'Identifier', name: token.value };
      }
    }

    if (this.matchPunctuator('[')) {
      return this.parseArrayLiteral();
    }

    if (this.matchPunctuator('{')) {
      return this.parseObjectLiteral();
    }

    throw this.error(`Unexpected token ${token.value || token.kind}`);
  }

  private tryParseParenthesizedArrow(): ArrowFunctionNode | null {
    const start = this.position;
    const params: string[] = [];

    if (!this.matchPunctuator(')')) {
      while (true) {
        const token = this.peek();
        if (token.kind !== 'identifier') {
          this.position = start;
          return null;
        }
        params.push(token.value);
        this.advance();

        if (this.matchPunctuator(')')) break;
        if (!this.matchPunctuator(',')) {
          this.position = start;
          return null;
        }
      }
    }

    if (!this.matchPunctuator('=>')) {
      this.position = start;
      return null;
    }

    return { type: 'ArrowFunction', params, body: this.parseAssignment() };
  }

  private parseArrayLiteral(): ArrayLiteralNode {
    const elements: ExpressionNode[] = [];
    if (this.matchPunctuator(']')) return { type: 'ArrayLiteral', elements };

    do {
      elements.push(this.parseBindingExpression());
    } while (this.matchPunctuator(',') && !this.checkPunctuator(']'));

    this.expectPunctuator(']', 'Expected ] after array literal');
    return { type: 'ArrayLiteral', elements };
  }

  private parseObjectLiteral(): ObjectLiteralNode {
    const properties: ObjectLiteralNode['properties'] = [];
    if (this.matchPunctuator('}')) return { type: 'ObjectLiteral', properties };

    do {
      let key: string | ExpressionNode;
      let shorthand = false;

      if (this.matchPunctuator('[')) {
        key = this.parseBindingExpression();
        this.expectPunctuator(']', 'Expected ] after computed object key');
      } else {
        const token = this.peek();
        if (token.kind !== 'identifier' && token.kind !== 'string' && token.kind !== 'number') {
          throw this.error('Expected object literal key');
        }
        this.advance();
        key = token.value;
      }

      let value: ExpressionNode;
      if (this.matchPunctuator(':')) {
        value = this.parseBindingExpression();
      } else if (typeof key === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
        shorthand = true;
        value = { type: 'Identifier', name: key };
      } else {
        throw this.error('Object literal property requires a value');
      }

      properties.push({ key, value, shorthand });
    } while (this.matchPunctuator(',') && !this.checkPunctuator('}'));

    this.expectPunctuator('}', 'Expected } after object literal');
    return { type: 'ObjectLiteral', properties };
  }

  private parseArgumentList(end: string): ExpressionNode[] {
    const args: ExpressionNode[] = [];
    if (this.matchPunctuator(end)) return args;

    do {
      args.push(this.parseBindingExpression());
    } while (this.matchPunctuator(',') && !this.checkPunctuator(end));

    this.expectPunctuator(end, `Expected ${end} after argument list`);
    return args;
  }

  private currentBinaryOperator(): string | null {
    const token = this.peek();
    if (token.kind === 'identifier' && token.value === 'in') return 'in';
    if (token.kind !== 'punctuator') return null;
    return binaryPrecedence.has(token.value) ? token.value : null;
  }

  private peek(offset = 0): Token {
    return this.tokens[this.position + offset] ?? this.tokens[this.tokens.length - 1]!;
  }

  private advance(): Token {
    return this.tokens[this.position++]!;
  }

  private checkPunctuator(value: string): boolean {
    const token = this.peek();
    return token.kind === 'punctuator' && token.value === value;
  }

  private matchPunctuator(value: string): boolean {
    if (!this.checkPunctuator(value)) return false;
    this.advance();
    return true;
  }

  private expectPunctuator(value: string, message: string): void {
    if (!this.matchPunctuator(value)) throw this.error(message);
  }

  private expectIdentifier(message: string): string {
    const token = this.peek();
    if (token.kind !== 'identifier') throw this.error(message);
    this.advance();
    return token.value;
  }

  private expectEof(): void {
    if (this.peek().kind !== 'eof') {
      throw this.error(`Unexpected token ${this.peek().value}`);
    }
  }

  private error(message: string): LamiError {
    return new LamiError('E_EXPR_PARSE', message, {
      source: this.source,
      index: this.peek().start
    });
  }
}
