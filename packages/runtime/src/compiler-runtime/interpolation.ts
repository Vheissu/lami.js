import type { Expression } from '../expression/ast.js';
import { parseExpression } from '../expression/evaluator.js';
import type { ExpressionOptions } from '../expression/ast.js';

export type InterpolationPart =
  | { type: 'text'; value: string }
  | { type: 'expression'; expression: Expression };

export function hasInterpolation(value: string): boolean {
  return /\$\{/.test(value);
}

export function parseInterpolation(value: string, options: ExpressionOptions = {}): InterpolationPart[] {
  const parts: InterpolationPart[] = [];
  let index = 0;

  while (index < value.length) {
    const start = value.indexOf('${', index);
    if (start === -1) {
      if (index < value.length) parts.push({ type: 'text', value: value.slice(index) });
      break;
    }

    if (start > index) {
      parts.push({ type: 'text', value: value.slice(index, start) });
    }

    const end = findInterpolationEnd(value, start + 2);
    const source = value.slice(start + 2, end).trim();
    parts.push({ type: 'expression', expression: parseExpression(source, options) });
    index = end + 1;
  }

  return parts;
}

function findInterpolationEnd(value: string, start: number): number {
  let quote: string | null = null;
  let depth = 0;

  for (let index = start; index < value.length; index++) {
    const char = value[index]!;
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char;
      continue;
    }

    if (quote) continue;
    if (char === '{') depth++;
    if (char === '}') {
      if (depth === 0) return index;
      depth--;
    }
  }

  throw new Error('Unterminated interpolation');
}
