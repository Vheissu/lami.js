import { LamiError } from '../util/errors.js';

export type TokenKind = 'identifier' | 'number' | 'string' | 'punctuator' | 'eof';

export interface Token {
  kind: TokenKind;
  value: string;
  start: number;
  end: number;
}

const multiCharPunctuators = [
  '===',
  '!==',
  '??=',
  '=>',
  '?.',
  '&&',
  '||',
  '??',
  '==',
  '!=',
  '<=',
  '>=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '...'
];

const singleCharPunctuators = new Set([
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '.',
  ',',
  ':',
  '?',
  '+',
  '-',
  '*',
  '/',
  '%',
  '!',
  '<',
  '>',
  '=',
  '|',
  '&'
]);

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index]!;

    if (/\s/.test(char)) {
      index++;
      continue;
    }

    if (char === '"' || char === "'") {
      tokens.push(readString(source, index));
      index = tokens[tokens.length - 1]!.end;
      continue;
    }

    if (isDigit(char) || (char === '.' && isDigit(source[index + 1] ?? ''))) {
      tokens.push(readNumber(source, index));
      index = tokens[tokens.length - 1]!.end;
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = index;
      index++;
      while (isIdentifierPart(source[index] ?? '')) index++;
      tokens.push({ kind: 'identifier', value: source.slice(start, index), start, end: index });
      continue;
    }

    const punctuator = multiCharPunctuators.find(value => source.startsWith(value, index));
    if (punctuator) {
      tokens.push({ kind: 'punctuator', value: punctuator, start: index, end: index + punctuator.length });
      index += punctuator.length;
      continue;
    }

    if (singleCharPunctuators.has(char)) {
      tokens.push({ kind: 'punctuator', value: char, start: index, end: index + 1 });
      index++;
      continue;
    }

    throw new LamiError('E_EXPR_PARSE', `Unexpected character "${char}"`, { source, index });
  }

  tokens.push({ kind: 'eof', value: '', start: source.length, end: source.length });
  return tokens;
}

function readString(source: string, start: number): Token {
  const quote = source[start]!;
  let value = '';
  let index = start + 1;

  while (index < source.length) {
    const char = source[index]!;
    if (char === quote) {
      return { kind: 'string', value, start, end: index + 1 };
    }

    if (char === '\\') {
      const escaped = source[index + 1];
      if (escaped === undefined) break;
      value += decodeEscape(escaped);
      index += 2;
      continue;
    }

    value += char;
    index++;
  }

  throw new LamiError('E_EXPR_PARSE', 'Unterminated string literal', { source, index: start });
}

function decodeEscape(char: string): string {
  switch (char) {
    case 'n': return '\n';
    case 'r': return '\r';
    case 't': return '\t';
    case 'b': return '\b';
    case 'f': return '\f';
    case 'v': return '\v';
    default: return char;
  }
}

function readNumber(source: string, start: number): Token {
  let index = start;
  if (source[index] === '.') index++;
  while (isDigit(source[index] ?? '')) index++;

  if (source[index] === '.') {
    index++;
    while (isDigit(source[index] ?? '')) index++;
  }

  if (source[index] === 'e' || source[index] === 'E') {
    const exponentStart = index;
    index++;
    if (source[index] === '+' || source[index] === '-') index++;
    if (!isDigit(source[index] ?? '')) {
      index = exponentStart;
    } else {
      while (isDigit(source[index] ?? '')) index++;
    }
  }

  return { kind: 'number', value: source.slice(start, index), start, end: index };
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}
