import {
  hasInterpolation,
  parseAttributeSyntax,
  parseInterpolation
} from '@lami.js/runtime';
import { parseRepeat } from '@lami.js/runtime/internal';
import type { AstElement, AstNode } from './ast.js';
import { emitCompiledExpression } from './codegen-expression.js';
import { hydrationMarkerId } from './hydration-markers.js';
import type { IrTemplate } from './ir.js';
import { parseTemplateAst } from './parse-html.js';

export function emitSsrModule(source: string, ir: IrTemplate): string {
  const ast = parseTemplateAst(source);
  return [
    "import {",
    "  Scope,",
    "  createRepeatLocals,",
    "  createResourceRegistry,",
    "  getIdentifier,",
    "  materialize,",
    "  parseExpression,",
    "  setIdentifier",
    "} from '@lami.js/runtime/internal';",
    "import { escapeHtml, renderAttrs } from '@lami.js/ssr/internal';",
    `export const metadata = ${JSON.stringify(ir, null, 2)};`,
    ssrHelpers,
    'export async function render(model, options = {}) {',
    '  const resources = createResourceRegistry(options.resources);',
    '  const scope = new Scope(model);',
    `  return ${emitNodes(ast.root.children, 'scope', [])};`,
    '}'
  ].join('\n');
}

export function canEmitDirectSsr(_ir: IrTemplate): boolean {
  return true;
}

function emitNodes(nodes: AstNode[], scope: string, parentPath: number[]): string {
  const consumedElseNodes = new Set<number>();
  const parts: string[] = [];
  let domIndex = 0;

  for (let index = 0; index < nodes.length; index++) {
    if (consumedElseNodes.has(index)) {
      parts.push(JSON.stringify('<!--lami:else-->'));
      domIndex++;
      continue;
    }

    const node = nodes[index]!;
    if (isIgnorableWhitespace(node)) {
      continue;
    }

    const elseNode = isIfElement(node)
      ? nextElseNode(nodes, index)
      : null;

    if (elseNode) consumedElseNodes.add(elseNode.index);
    parts.push(emitNode(node, scope, [...parentPath, domIndex], elseNode?.node));
    domIndex++;
  }

  return concat(parts);
}

function isIgnorableWhitespace(node: AstNode): boolean {
  return node.kind === 'text' &&
    node.value.includes('\n') &&
    /^\s*$/.test(node.value);
}

function emitNode(node: AstNode, scope: string, path: number[], elseNode?: AstElement): string {
  switch (node.kind) {
    case 'text':
      return emitText(node.value, scope);
    case 'comment':
      return JSON.stringify(`<!--${node.value}-->`);
    case 'element':
      return emitElement(node, scope, path, elseNode);
  }
}

function emitElement(node: AstElement, scope: string, path: number[] = [0], elseNode?: AstElement): string {
  if (node.tagName === 'let') return emitLet(node, scope);

  const controller = controllerAttr(node);
  if (controller) {
    switch (controller.name) {
      case 'if': return emitIf(node, controller.value, scope, path, elseNode);
      case 'repeat': return emitRepeat(node, controller.value, scope, path);
      case 'with': return emitWith(node, controller.value, scope, path);
      case 'switch': return emitSwitch(node, controller.value, scope, path);
      case 'promise': return emitPromise(node, controller.value, scope, path);
    }
  }

  if (node.tagName === 'template') return emitNodes(node.children, scope, path);

  return concat([
    JSON.stringify(`<${node.tagName}`),
    emitAttrs(node, scope),
    JSON.stringify('>'),
    emitNodes(node.children, scope, path),
    JSON.stringify(`</${node.tagName}>`)
  ]);
}

function emitText(value: string, scope: string): string {
  if (!hasInterpolation(value)) return JSON.stringify(escapeText(value));
  const parts = parseInterpolation(value).map(part => part.type === 'text'
    ? JSON.stringify(escapeText(part.value))
    : `escapeHtml(${evalExpr(part.expression.source, scope)})`);
  return concat(parts);
}

function emitAttrs(node: AstElement, scope: string): string {
  const statements: string[] = ['const attrs = {};'];

  for (const attr of node.attrs) {
    const syntax = parseAttributeSyntax(attr.name, attr.value);

    if (syntax.rawName.startsWith('...')) {
      const source = syntax.target === '$bindables' ? attr.value : kebabToCamel(syntax.target);
      statements.push(`Object.assign(attrs, __spread(${evalExpr(source, scope)}));`);
      continue;
    }

    if (syntax.command === 'trigger' || syntax.command === 'capture') continue;
    if (syntax.rawName === 'ref' || syntax.command === 'ref') continue;

    if (syntax.command === 'class') {
      statements.push(`__classTokens(attrs, ${JSON.stringify(syntax.target.split(',').filter(Boolean))}, ${evalExpr(attr.value, scope)});`);
      continue;
    }

    if (syntax.command === 'style') {
      statements.push(`__styleProp(attrs, ${JSON.stringify(syntax.target)}, ${evalExpr(attr.value, scope)});`);
      continue;
    }

    if (syntax.command === 'bind' && (syntax.target === 'show' || syntax.target === 'hide')) {
      statements.push(`__showHide(attrs, ${evalExpr(attr.value, scope)}, ${JSON.stringify(syntax.target === 'hide')});`);
      continue;
    }

    if (isBindingCommand(syntax.command)) {
      if (syntax.target === 'class') {
        statements.push(`__mergeClass(attrs, ${evalExpr(attr.value, scope)});`);
      } else if (syntax.target === 'style') {
        statements.push(`attrs.style = __style(${evalExpr(attr.value, scope)});`);
      } else if (syntax.target.startsWith('style.')) {
        statements.push(`__styleProp(attrs, ${JSON.stringify(syntax.target.slice('style.'.length))}, ${evalExpr(attr.value, scope)});`);
      } else if (!isControllerTarget(syntax.target)) {
        statements.push(`attrs[${JSON.stringify(normalizeTarget(syntax.target))}] = ${evalExpr(attr.value, scope)};`);
      }
      continue;
    }

    if (syntax.command !== null || isDirectiveAttr(attr.name)) continue;

    if (hasInterpolation(attr.value)) {
      statements.push(`attrs[${JSON.stringify(attr.name)}] = ${emitInterpolationValue(attr.value, scope)};`);
    } else {
      statements.push(`attrs[${JSON.stringify(attr.name)}] = ${attr.value === '' ? 'true' : JSON.stringify(attr.value)};`);
    }
  }

  statements.push('return renderAttrs(attrs);');
  return `(() => { ${statements.join(' ')} })()`;
}

function emitInterpolationValue(value: string, scope: string): string {
  const parts = parseInterpolation(value).map(part => part.type === 'text'
    ? JSON.stringify(part.value)
    : `__string(${evalExpr(part.expression.source, scope)})`);
  return concat(parts);
}

function emitLet(node: AstElement, scope: string): string {
  const statements: string[] = [];
  const toBindingContext = node.attrs.some(attr => attr.name === 'to-binding-context');
  for (const attr of node.attrs) {
    if (attr.name === 'to-binding-context') continue;
    const syntax = parseAttributeSyntax(attr.name, attr.value);
    if (!isBindingCommand(syntax.command)) continue;
    const target = toBindingContext
      ? `${scope}.bindingContext`
      : `${scope}.locals`;
    statements.push(`${target}[${JSON.stringify(kebabToCamel(syntax.target))}] = ${evalExpr(attr.value, scope)};`);
  }
  return `(() => { ${statements.join(' ')} return '<!--lami:let-->'; })()`;
}

function emitIf(node: AstElement, source: string, scope: string, path: number[], elseNode?: AstElement): string {
  const marker = hydrationMarkerId('if', path, source);
  const ifNode = cloneElementWithoutAttrs(node, ['if.bind']);
  const ifHtml = emitElement(ifNode, scope, path);
  const elseHtml = elseNode
    ? emitElement(cloneElementWithoutAttrs(elseNode, ['else']), scope, path)
    : JSON.stringify('');
  return concat([
    JSON.stringify(`<!--lami:${marker}:start-->`),
    `((${evalExpr(source, scope)}) ? ${ifHtml} : ${elseHtml})`,
    JSON.stringify(`<!--lami:${marker}:end-->`)
  ]);
}

function emitRepeat(node: AstElement, source: string, scope: string, path: number[]): string {
  const marker = hydrationMarkerId('repeat', path, source);
  const definition = parseRepeat(source);
  const template = emitElement(cloneElementWithoutAttrs(node, ['repeat.for']), 'childScope', path);
  return concat([
    JSON.stringify(`<!--lami:${marker}:start-->`),
    `(await Promise.all(materialize(${evalExpr(definition.items, scope)}).map(async (item, index, items) => { const childScope = ${scope}.withLocals(createRepeatLocals(${JSON.stringify(definition.pattern)}, item, index, items.length, items[index - 1])); return ${template}; }))).join('')`,
    JSON.stringify(`<!--lami:${marker}:end-->`)
  ]);
}

function emitWith(node: AstElement, source: string, scope: string, path: number[]): string {
  const marker = hydrationMarkerId('with', path, source);
  const template = emitElement(cloneElementWithoutAttrs(node, ['with.bind']), 'childScope', path);
  return concat([
    JSON.stringify(`<!--lami:${marker}:start-->`),
    `await (async () => { const value = ${evalExpr(source, scope)}; const childScope = ${scope}.withContext(value && typeof value === 'object' ? value : {}); return ${template}; })()`,
    JSON.stringify(`<!--lami:${marker}:end-->`)
  ]);
}

function emitSwitch(node: AstElement, source: string, scope: string, path: number[]): string {
  const marker = hydrationMarkerId('switch', path, source);
  const cases: string[] = [];
  let defaultCase = JSON.stringify('');

  for (const child of node.children) {
    if (child.kind !== 'element') continue;
    const literal = child.attrs.find(attr => attr.name === 'case');
    if (literal) {
      cases.push(`if (Object.is(String(value), ${JSON.stringify(literal.value)})) return ${emitElement(cloneElementWithoutAttrs(child, ['case']), scope, path)};`);
      continue;
    }

    const bound = child.attrs.find(attr => attr.name === 'case.bind');
    if (bound) {
      cases.push(`{ const caseValue = ${evalExpr(bound.value, scope)}; const matches = Array.isArray(caseValue) ? caseValue.some(item => Object.is(item, value)) : Object.is(caseValue, value); if (matches) return ${emitElement(cloneElementWithoutAttrs(child, ['case.bind']), scope, path)}; }`);
      continue;
    }

    if (child.attrs.some(attr => attr.name === 'default-case')) {
      defaultCase = emitElement(cloneElementWithoutAttrs(child, ['default-case']), scope, path);
    }
  }

  return concat([
    JSON.stringify(`<!--lami:${marker}:start-->`),
    `await (async () => { const value = ${evalExpr(source, scope)}; ${cases.join(' ')} return ${defaultCase}; })()`,
    JSON.stringify(`<!--lami:${marker}:end-->`)
  ]);
}

function emitPromise(node: AstElement, source: string, scope: string, path: number[]): string {
  const marker = hydrationMarkerId('promise', [...path, 0], source);
  let thenBranch = JSON.stringify('');
  let catchBranch = JSON.stringify('');

  for (const child of node.children) {
    if (child.kind !== 'element') continue;
    const thenAttr = child.attrs.find(attr => attr.name === 'then');
    if (thenAttr) {
      const local = thenAttr.value || 'value';
      thenBranch = `await (async () => { const childScope = ${scope}.withLocal(${JSON.stringify(local)}, value); return ${emitElement(cloneElementWithoutAttrs(child, ['then']), 'childScope', path)}; })()`;
      continue;
    }

    const catchAttr = child.attrs.find(attr => attr.name === 'catch');
    if (catchAttr) {
      const local = catchAttr.value || 'error';
      catchBranch = `await (async () => { const childScope = ${scope}.withLocal(${JSON.stringify(local)}, error); return ${emitElement(cloneElementWithoutAttrs(child, ['catch']), 'childScope', path)}; })()`;
    }
  }

  return concat([
    JSON.stringify(`<${node.tagName}`),
    emitStaticHostAttrs(node, 'promise.bind'),
    JSON.stringify('>'),
    JSON.stringify(`<!--lami:${marker}:start-->`),
    `await (async () => { try { const value = await ${evalExpr(source, scope)}; return ${thenBranch}; } catch (error) { return ${catchBranch}; } })()`,
    JSON.stringify(`<!--lami:${marker}:end-->`),
    JSON.stringify(`</${node.tagName}>`)
  ]);
}

function evalExpr(source: string, scope: string): string {
  return `__eval(${emitCompiledExpression(source)}, ${scope}, resources, options.dev)`;
}

function concat(parts: string[]): string {
  if (!parts.length) return JSON.stringify('');
  return parts.join(' + ');
}

function controllerAttr(node: AstElement): { name: 'if' | 'repeat' | 'with' | 'switch' | 'promise'; value: string } | null {
  const entries: Array<['if' | 'repeat' | 'with' | 'switch' | 'promise', string]> = [
    ['if', 'if.bind'],
    ['repeat', 'repeat.for'],
    ['with', 'with.bind'],
    ['switch', 'switch.bind'],
    ['promise', 'promise.bind']
  ];

  for (const [name, attrName] of entries) {
    const attr = node.attrs.find(item => item.name === attrName);
    if (attr) return { name, value: attr.value };
  }

  return null;
}

function cloneElementWithoutAttrs(node: AstElement, attrNames: string[]): AstElement {
  const remove = new Set(attrNames);
  return {
    ...node,
    attrs: node.attrs.filter(attr => !remove.has(attr.name))
  };
}

function isIfElement(node: AstNode): node is AstElement {
  return node.kind === 'element' && node.attrs.some(attr => attr.name === 'if.bind');
}

function nextElseNode(nodes: AstNode[], index: number): { index: number; node: AstElement } | null {
  for (let cursor = index + 1; cursor < nodes.length; cursor++) {
    const node = nodes[cursor]!;
    if (node.kind === 'text' && node.value.trim() === '') continue;
    if (node.kind === 'element' && node.attrs.some(attr => attr.name === 'else')) return { index: cursor, node };
    return null;
  }
  return null;
}

function isBindingCommand(command: string | null): boolean {
  return command === 'bind' ||
    command === 'to-view' ||
    command === 'one-way' ||
    command === 'two-way' ||
    command === 'from-view' ||
    command === 'one-time' ||
    command === 'attr';
}

function isControllerTarget(target: string): boolean {
  return target === 'if' ||
    target === 'repeat' ||
    target === 'show' ||
    target === 'hide' ||
    target === 'with' ||
    target === 'switch' ||
    target === 'promise';
}

function isDirectiveAttr(name: string): boolean {
  return name === 'else' ||
    name === 'case' ||
    name === 'case.bind' ||
    name === 'default-case' ||
    name === 'pending' ||
    name === 'then' ||
    name === 'catch';
}

function emitStaticHostAttrs(node: AstElement, controllerAttrName: string): string {
  const attrs: Record<string, string | true> = {};
  for (const attr of node.attrs) {
    if (attr.name === controllerAttrName) continue;
    if (attr.syntax.command !== null || attr.syntax.rawName.startsWith('...')) continue;
    if (hasInterpolation(attr.value) || isDirectiveAttr(attr.name)) continue;
    attrs[attr.name] = attr.value === '' ? true : attr.value;
  }

  return `renderAttrs(${JSON.stringify(attrs)})`;
}

function normalizeTarget(target: string): string {
  return target === 'text' ? 'textContent' : target;
}

function kebabToCamel(value: string): string {
  return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, char => textEscapes[char]!);
}

const textEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;'
};

const ssrHelpers = `
function __eval(expression, scope, resources, dev) {
  return typeof expression === 'string'
    ? parseExpression(expression, { resources, dev }).evaluate(scope)
    : expression.evaluate(scope);
}

function __string(value) {
  return value == null ? '' : String(value);
}

function __spread(value) {
  return value && typeof value === 'object' ? { ...value } : {};
}

function __class(value) {
  if (value == null || value === false) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter(Boolean).map(String).join(' ');
  if (typeof value === 'object') {
    return Object.entries(value).filter(([, enabled]) => !!enabled).map(([name]) => name).join(' ');
  }
  return String(value);
}

function __mergeClass(attrs, value) {
  const next = __class(value);
  if (!next) return;
  attrs.class = [attrs.class, next].filter(Boolean).join(' ');
}

function __classTokens(attrs, tokens, enabled) {
  if (enabled) __mergeClass(attrs, tokens.join(' '));
}

function __style(value) {
  if (value == null || value === false) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);
  return Object.entries(value)
    .filter(([, next]) => next !== null && next !== undefined && next !== false)
    .map(([key, next]) => __cssName(key) + ': ' + String(next))
    .join('; ');
}

function __styleProp(attrs, property, value) {
  if (value === null || value === undefined || value === false) return;
  const declaration = __cssName(property) + ': ' + String(value);
  attrs.style = attrs.style
    ? (String(attrs.style).trim().endsWith(';') ? attrs.style + ' ' + declaration : attrs.style + '; ' + declaration)
    : declaration;
}

function __showHide(attrs, value, invert) {
  const visible = invert ? !value : !!value;
  if (!visible) __styleProp(attrs, 'display', 'none');
}

function __cssName(value) {
  return value.includes('-') ? value : value.replace(/[A-Z]/g, char => '-' + char.toLowerCase());
}
`;
