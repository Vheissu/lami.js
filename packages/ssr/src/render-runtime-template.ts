import * as parse5 from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import {
  createResourceRegistry,
  hasInterpolation,
  parseAttributeSyntax,
  parseExpression,
  parseInterpolation,
  Scope,
  type ResourceRegistryInit
} from '@lami.js/runtime';
import { escapeAttribute, escapeHtml } from './escape.js';
import { renderAttrs } from './render-attrs.js';

export interface RenderRuntimeOptions {
  resources?: ResourceRegistryInit;
  dev?: boolean;
}

export async function renderRuntimeTemplate(
  template: string,
  model: object,
  options: RenderRuntimeOptions = {}
): Promise<string> {
  const fragment = parse5.parseFragment(template);
  const scope = new Scope(model);
  const resources = createResourceRegistry(options.resources);
  return renderNodes(fragment.childNodes, scope, { ...options, resources });
}

type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type TextNode = DefaultTreeAdapterTypes.TextNode;
type CommentNode = DefaultTreeAdapterTypes.CommentNode;
type ElementNode = DefaultTreeAdapterTypes.Element & {
  content?: DefaultTreeAdapterTypes.DocumentFragment;
};
type AttributeNode = ElementNode['attrs'][number];

interface RenderContext {
  dev?: boolean;
  resources: ReturnType<typeof createResourceRegistry>;
}

async function renderNodes(nodes: ChildNode[], scope: Scope, context: RenderContext): Promise<string> {
  const rendered = await Promise.all(nodes.map(node => renderNode(node, scope, context)));
  return rendered.join('');
}

async function renderNode(node: ChildNode, scope: Scope, context: RenderContext): Promise<string> {
  if (isTextNode(node)) {
    if (!hasInterpolation(node.value)) return escapeHtml(node.value);
    const parts = parseInterpolation(node.value, context)
      .map(part => part.type === 'text' ? escapeHtml(part.value) : escapeHtml(part.expression.evaluate(scope)));
    return parts.join('');
  }

  if (isCommentNode(node)) return `<!--${node.data}-->`;
  if (!isElementNode(node)) return '';

  const ifAttr = findAttr(node, 'if.bind');
  if (ifAttr) {
    const expression = parseExpression(ifAttr.value, context);
    if (!expression.evaluate(scope)) return '';
  }

  const repeatAttr = findAttr(node, 'repeat.for');
  if (repeatAttr) return renderRepeat(node, repeatAttr.value, scope, context);

  const withAttr = findAttr(node, 'with.bind');
  if (withAttr) return renderWith(node, withAttr.value, scope, context);

  const switchAttr = findAttr(node, 'switch.bind');
  if (switchAttr) return renderSwitch(node, switchAttr.value, scope, context);

  const promiseAttr = findAttr(node, 'promise.bind');
  if (promiseAttr) return renderPromise(node, promiseAttr.value, scope, context);

  if (isBranchOnlyNode(node)) return '';

  const attrs = renderableAttrs(node, scope, context);
  const children = await renderNodes(childNodesOf(node), scope, context);

  if (node.tagName === 'template') return children;
  return `<${node.tagName}${renderAttrs(attrs)}>${children}</${node.tagName}>`;
}

async function renderRepeat(node: ElementNode, source: string, scope: Scope, context: RenderContext): Promise<string> {
  const match = /^(.*?)\s+of\s+(.+?)(?:\s*;\s*key\s*:\s*(.+))?$/.exec(source.trim());
  if (!match) return '';

  const pattern = match[1]!.trim();
  const items = materialize(parseExpression(match[2]!.trim(), context).evaluate(scope));
  const rendered: string[] = [];

  for (let index = 0; index < items.length; index++) {
    const localScope = scope.withLocals({
      ...destructurePattern(pattern, items[index]),
      $index: index,
      $first: index === 0,
      $last: index === items.length - 1,
      $even: index % 2 === 0,
      $odd: index % 2 === 1,
      $length: items.length,
      $previous: items[index - 1]
    });

    rendered.push(await renderNode(cloneWithoutAttrs(node, ['repeat.for']), localScope, context));
  }

  return rendered.join('');
}

async function renderWith(node: ElementNode, source: string, scope: Scope, context: RenderContext): Promise<string> {
  const value = parseExpression(source, context).evaluate(scope);
  const childContext = value && typeof value === 'object' ? value as object : {};
  return renderNode(cloneWithoutAttrs(node, ['with.bind']), scope.withContext(childContext), context);
}

async function renderSwitch(node: ElementNode, source: string, scope: Scope, context: RenderContext): Promise<string> {
  const switchValue = parseExpression(source, context).evaluate(scope);
  const children = childNodesOf(node).filter(isElementNode);
  let defaultNode: ElementNode | undefined;

  for (const child of children) {
    const caseAttr = findAttr(child, 'case');
    if (caseAttr && Object.is(String(switchValue), caseAttr.value)) {
      return renderNode(cloneWithoutAttrs(child, ['case']), scope, context);
    }

    const boundCase = findAttr(child, 'case.bind');
    if (boundCase) {
      const caseValue = parseExpression(boundCase.value, context).evaluate(scope);
      const matches = Array.isArray(caseValue)
        ? caseValue.some(value => Object.is(value, switchValue))
        : Object.is(caseValue, switchValue);
      if (matches) return renderNode(cloneWithoutAttrs(child, ['case.bind']), scope, context);
    }

    if (findAttr(child, 'default-case')) defaultNode = child;
  }

  return defaultNode
    ? renderNode(cloneWithoutAttrs(defaultNode, ['default-case']), scope, context)
    : '';
}

async function renderPromise(node: ElementNode, source: string, scope: Scope, context: RenderContext): Promise<string> {
  const value = parseExpression(source, context).evaluate(scope);
  const children = childNodesOf(node).filter(isElementNode);

  const pending = children.find(child => findAttr(child, 'pending'));
  const thenBranch = children.find(child => findAttr(child, 'then'));
  const catchBranch = children.find(child => findAttr(child, 'catch'));

  try {
    const resolved = await value;
    if (!thenBranch) return '';
    const local = findAttr(thenBranch, 'then')?.value || 'value';
    return renderNode(cloneWithoutAttrs(thenBranch, ['then']), scope.withLocal(local, resolved), context);
  } catch (error) {
    if (!catchBranch) return '';
    const local = findAttr(catchBranch, 'catch')?.value || 'error';
    return renderNode(cloneWithoutAttrs(catchBranch, ['catch']), scope.withLocal(local, error), context);
  } finally {
    void pending;
  }
}

function renderableAttrs(node: ElementNode, scope: Scope, context: RenderContext): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};

  for (const attr of node.attrs) {
    const syntax = parseAttributeSyntax(attr.name, attr.value);
    if (syntax.rawName.startsWith('...')) {
      const source = syntax.target === '$bindables' ? attr.value : kebabToCamel(syntax.target);
      Object.assign(attrs, normalizeSpread(parseExpression(source, context).evaluate(scope)));
      continue;
    }

    if (syntax.command || isDirectiveAttr(attr.name)) continue;
    attrs[attr.name] = hasInterpolation(attr.value)
      ? parseInterpolation(attr.value, context).map(part => part.type === 'text' ? part.value : part.expression.evaluate(scope)).join('')
      : attr.value;
  }

  for (const attr of node.attrs) {
    const syntax = parseAttributeSyntax(attr.name, attr.value);
    if (syntax.command === 'class') {
      applyClassTokens(attrs, syntax.target, parseExpression(attr.value, context).evaluate(scope));
      continue;
    }

    if (syntax.command === 'style') {
      applyStyleProperty(attrs, syntax.target, parseExpression(attr.value, context).evaluate(scope));
      continue;
    }

    if (!isRenderablePropertyCommand(syntax.command)) continue;
    if (isControllerTarget(syntax.target)) continue;

    const value = parseExpression(attr.value, context).evaluate(scope);
    if (syntax.target === 'class') {
      mergeClass(attrs, value);
    } else if (syntax.target === 'style') {
      attrs.style = normalizeStyleValue(value);
    } else if (syntax.target.startsWith('style.')) {
      applyStyleProperty(attrs, syntax.target.slice('style.'.length), value);
    } else {
      attrs[syntax.target] = value;
    }
  }

  applyShowHide(node, attrs, scope, context);

  return attrs;
}

function applyShowHide(
  node: ElementNode,
  attrs: Record<string, unknown>,
  scope: Scope,
  context: RenderContext
): void {
  const showAttr = findAttr(node, 'show.bind');
  if (showAttr && !parseExpression(showAttr.value, context).evaluate(scope)) {
    attrs.style = appendStyle(attrs.style, 'display: none');
  }

  const hideAttr = findAttr(node, 'hide.bind');
  if (hideAttr && parseExpression(hideAttr.value, context).evaluate(scope)) {
    attrs.style = appendStyle(attrs.style, 'display: none');
  }
}

function appendStyle(value: unknown, declaration: string): string {
  const current = value === null || value === undefined || value === false
    ? ''
    : String(value).trim();
  if (!current) return declaration;
  return current.endsWith(';')
    ? `${current} ${declaration}`
    : `${current}; ${declaration}`;
}

function mergeClass(attrs: Record<string, unknown>, value: unknown): void {
  const classNames = normalizeClassValue(value);
  if (!classNames.length) return;

  const current = attrs.class === null || attrs.class === undefined || attrs.class === false
    ? []
    : String(attrs.class).split(/\s+/).filter(Boolean);
  attrs.class = [...current, ...classNames].join(' ');
}

function applyClassTokens(attrs: Record<string, unknown>, tokenList: string, enabled: unknown): void {
  if (!enabled) return;
  mergeClass(attrs, tokenList.split(',').filter(Boolean));
}

function normalizeClassValue(value: unknown): string[] {
  if (value === null || value === undefined || value === false) return [];
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => !!enabled)
      .map(([className]) => className);
  }
  return [String(value)];
}

function normalizeStyleValue(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);

  return Object.entries(value as Record<string, unknown>)
    .filter(([, next]) => next !== null && next !== undefined && next !== false)
    .map(([key, next]) => `${toCssProperty(key)}: ${String(next)}`)
    .join('; ');
}

function applyStyleProperty(attrs: Record<string, unknown>, property: string, value: unknown): void {
  if (value === null || value === undefined || value === false) return;
  attrs.style = appendStyle(attrs.style, `${toCssProperty(property)}: ${String(value)}`);
}

function toCssProperty(value: string): string {
  return value.includes('-')
    ? value
    : value.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`);
}

function normalizeSpread(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? { ...value as Record<string, unknown> }
    : {};
}

function kebabToCamel(value: string): string {
  return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function cloneWithoutAttrs(node: ElementNode, names: string[]): ElementNode {
  const remove = new Set(names);
  return {
    ...node,
    attrs: node.attrs.filter(attr => !remove.has(attr.name))
  };
}

function childNodesOf(node: ElementNode): ChildNode[] {
  return node.tagName === 'template' && node.content
    ? node.content.childNodes
    : node.childNodes;
}

function materialize(value: unknown): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'number') return Array.from({ length: Math.max(0, value) }, (_, index) => index);
  if (value instanceof Map) return Array.from(value.entries());
  if (value instanceof Set) return Array.from(value.values());
  if (typeof value === 'object' && Symbol.iterator in value) return Array.from(value as Iterable<unknown>);
  return [];
}

function destructurePattern(pattern: string, item: unknown): Record<string, unknown> {
  const trimmed = pattern.trim();
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) return { [trimmed]: item };

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const values = Array.isArray(item) ? item : [];
    return Object.fromEntries(trimmed.slice(1, -1).split(',').map((name, index) => [name.trim(), values[index]]));
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const source = item as Record<string, unknown>;
    return Object.fromEntries(trimmed.slice(1, -1).split(',').map(name => {
      const key = name.trim();
      return [key, source?.[key]];
    }));
  }

  return {};
}

function isRenderablePropertyCommand(command: string | null): boolean {
  return command === 'bind' || command === 'to-view' || command === 'one-way' || command === 'one-time' || command === 'attr';
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

function isBranchOnlyNode(node: ElementNode): boolean {
  return Boolean(
    findAttr(node, 'case') ||
    findAttr(node, 'case.bind') ||
    findAttr(node, 'default-case') ||
    findAttr(node, 'pending') ||
    findAttr(node, 'then') ||
    findAttr(node, 'catch')
  );
}

function findAttr(node: ElementNode, name: string): AttributeNode | undefined {
  return node.attrs.find(attr => attr.name === name);
}

function isTextNode(node: ChildNode): node is TextNode {
  return node.nodeName === '#text';
}

function isCommentNode(node: ChildNode): node is CommentNode {
  return node.nodeName === '#comment';
}

function isElementNode(node: ChildNode): node is ElementNode {
  return 'tagName' in node;
}
