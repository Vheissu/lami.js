import {
  BindingMode,
  hasInterpolation,
  parseInterpolation,
  type BindingCommandName
} from '@lami.js/runtime';
import type { AstAttribute, AstElement, AstNode, TemplateAst } from './ast.js';
import { parseTemplateAst } from './parse-html.js';

export interface IrTemplate {
  staticHtml: string;
  expressions: IrExpression[];
  bindings: IrBinding[];
  factories: IrViewFactory[];
}

export interface IrExpression {
  id: number;
  source: string;
}

export type IrBinding =
  | IrTextBinding
  | IrAttributeInterpolationBinding
  | IrClassBinding
  | IrPropertyBinding
  | IrShowBinding
  | IrStyleBinding
  | IrEventBinding
  | IrLetBinding
  | IrTemplateControllerBinding
  | IrRefBinding
  | IrSpreadBinding;

export interface IrTextBinding {
  kind: 'text';
  path: number[];
  parts: IrInterpolationPart[];
}

export interface IrAttributeInterpolationBinding {
  kind: 'attributeInterpolation';
  path: number[];
  target: string;
  parts: IrInterpolationPart[];
}

export type IrInterpolationPart =
  | { type: 'text'; value: string }
  | { type: 'expression'; expressionId: number };

export interface IrPropertyBinding {
  kind: 'property';
  path: number[];
  target: string;
  mode: BindingMode;
  expressionId: number;
  forceAttribute: boolean;
}

export interface IrClassBinding {
  kind: 'class';
  path: number[];
  tokens: string[];
  expressionId: number;
}

export interface IrShowBinding {
  kind: 'show';
  path: number[];
  expressionId: number;
  invert: boolean;
}

export interface IrStyleBinding {
  kind: 'style';
  path: number[];
  property: string;
  expressionId: number;
}

export interface IrEventBinding {
  kind: 'event';
  path: number[];
  eventName: string;
  capture: boolean;
  modifiers: string[];
  expressionId: number;
}

export interface IrLetBinding {
  kind: 'let';
  path: number[];
  property: string;
  expressionId: number;
  toBindingContext: boolean;
}

export interface IrTemplateControllerBinding {
  kind: 'templateController';
  controller: 'if' | 'repeat' | 'with' | 'switch' | 'promise';
  path: number[];
  expressionId: number;
  factoryId?: number;
  elseFactoryId?: number;
  cases?: IrSwitchCase[];
  defaultFactoryId?: number;
  promise?: IrPromiseBranches;
}

export interface IrSwitchCase {
  factoryId: number;
  match:
    | { type: 'literal'; value: string }
    | { type: 'expression'; expressionId: number };
}

export interface IrPromiseBranches {
  pendingFactoryId?: number;
  then?: {
    local: string;
    factoryId: number;
  };
  catch?: {
    local: string;
    factoryId: number;
  };
}

export interface IrRefBinding {
  kind: 'ref';
  path: number[];
  target: string;
  property: string;
}

export interface IrSpreadBinding {
  kind: 'spread';
  path: number[];
  expressionId: number;
  bindablesOnly: boolean;
}

export interface IrViewFactory {
  id: number;
  ast: AstNode;
  staticHtml: string;
  expressions: IrExpression[];
  bindings: IrBinding[];
  factories: IrViewFactory[];
}

interface BuildContext {
  expressions: IrExpression[];
  bindings: IrBinding[];
  factories: IrViewFactory[];
}

export function compileToIr(source: string): IrTemplate {
  return astToIr(parseTemplateAst(source));
}

export function astToIr(ast: TemplateAst): IrTemplate {
  const context: BuildContext = {
    expressions: [],
    bindings: [],
    factories: []
  };

  const staticHtml = buildChildren(ast.root.children, [], context);

  return {
    staticHtml,
    expressions: context.expressions,
    bindings: context.bindings,
    factories: context.factories
  };
}

function buildChildren(nodes: AstNode[], parentPath: number[], context: BuildContext): string {
  const consumedElseNodes = new Set<number>();
  const chunks: string[] = [];
  let domIndex = 0;

  for (let index = 0; index < nodes.length; index++) {
    if (consumedElseNodes.has(index)) {
      chunks.push('<!--lami:else-->');
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
    chunks.push(buildNode(node, [...parentPath, domIndex], context, elseNode?.node).html);
    domIndex++;
  }

  return chunks.join('');
}

function isIgnorableWhitespace(node: AstNode): boolean {
  return node.kind === 'text' &&
    node.value.includes('\n') &&
    /^\s*$/.test(node.value);
}

function buildNode(
  node: AstNode,
  path: number[],
  context: BuildContext,
  elseNode?: AstElement
): { html: string } {
  switch (node.kind) {
    case 'text': {
      if (!hasInterpolation(node.value)) return { html: escapeText(node.value) };
      const parts = interpolationParts(node.value, context);
      context.bindings.push({ kind: 'text', path, parts });
      return { html: ' ' };
    }

    case 'comment':
      return { html: `<!--${node.value}-->` };

    case 'element':
      return buildElement(node, path, context, elseNode);
  }
}

function buildElement(
  node: AstElement,
  path: number[],
  context: BuildContext,
  elseNode?: AstElement
): { html: string } {
  if (node.tagName === 'let') {
    return buildLetElement(node, path, context);
  }

  const controller = controllerAttr(node);
  if (controller) {
    if (controller.name === 'switch') {
      return buildSwitchController(node, path, controller.attr, context);
    }

    if (controller.name === 'promise') {
      return buildPromiseController(node, path, controller.attr, context);
    }

    const expressionId = addExpression(controller.attr.value, context);
    const cleaned = cloneElementWithoutAttrs(node, [controller.attr.name]);
    const factoryId = addViewFactory(cleaned, context);
    const elseFactoryId = controller.name === 'if' && elseNode
      ? addViewFactory(cloneElementWithoutAttrs(elseNode, ['else']), context)
      : undefined;
    context.bindings.push({
      kind: 'templateController',
      controller: controller.name,
      path,
      expressionId,
      factoryId,
      ...(elseFactoryId === undefined ? {} : { elseFactoryId })
    });
    return { html: `<!--lami:${controller.name}:${factoryId}-->` };
  }

  const staticAttrs: string[] = [];

  for (const attr of node.attrs) {
    const syntax = attr.syntax;
    if (syntax.rawName.startsWith('...')) {
      context.bindings.push({
        kind: 'spread',
        path,
        expressionId: addExpression(syntax.target === '$bindables' ? attr.value : kebabToCamel(syntax.target), context),
        bindablesOnly: true
      });
      continue;
    }

    if (syntax.command === 'trigger' || syntax.command === 'capture') {
      context.bindings.push({
        kind: 'event',
        path,
        eventName: syntax.target,
        capture: syntax.command === 'capture',
        modifiers: syntax.modifiers,
        expressionId: addExpression(attr.value, context)
      });
      continue;
    }

    if (syntax.command === 'class') {
      context.bindings.push({
        kind: 'class',
        path,
        tokens: syntax.target.split(',').filter(Boolean),
        expressionId: addExpression(attr.value, context)
      });
      continue;
    }

    if (syntax.command === 'style') {
      context.bindings.push({
        kind: 'style',
        path,
        property: syntax.target,
        expressionId: addExpression(attr.value, context)
      });
      continue;
    }

    if (syntax.command === 'bind' && (syntax.target === 'show' || syntax.target === 'hide')) {
      context.bindings.push({
        kind: 'show',
        path,
        expressionId: addExpression(attr.value, context),
        invert: syntax.target === 'hide'
      });
      continue;
    }

    if (isBindingCommand(syntax.command) && syntax.target.startsWith('style.')) {
      context.bindings.push({
        kind: 'style',
        path,
        property: syntax.target.slice('style.'.length),
        expressionId: addExpression(attr.value, context)
      });
      continue;
    }

    if (syntax.rawName === 'ref' || syntax.command === 'ref') {
      context.bindings.push({
        kind: 'ref',
        path,
        target: syntax.target,
        property: attr.value || syntax.target
      });
      continue;
    }

    if (isBindingCommand(syntax.command)) {
      context.bindings.push({
        kind: 'property',
        path,
        target: normalizeTarget(syntax.target),
        mode: resolveCompilerMode(syntax.command, node.tagName, normalizeTarget(syntax.target)),
        expressionId: addExpression(attr.value, context),
        forceAttribute: syntax.command === 'attr'
      });
      continue;
    }

    if (hasInterpolation(attr.value)) {
      context.bindings.push({
        kind: 'attributeInterpolation',
        path,
        target: attr.name,
        parts: interpolationParts(attr.value, context)
      });
      staticAttrs.push(`${attr.name}=""`);
      continue;
    }

    if (isDirectiveAttr(attr.name)) continue;
    staticAttrs.push(attr.value === '' ? attr.name : `${attr.name}="${escapeAttribute(attr.value)}"`);
  }

  const attrs = staticAttrs.length ? ` ${staticAttrs.join(' ')}` : '';
  const children = buildChildren(node.children, path, context);
  return { html: `<${node.tagName}${attrs}>${children}</${node.tagName}>` };
}

function buildSwitchController(
  node: AstElement,
  path: number[],
  attr: AstAttribute,
  context: BuildContext
): { html: string } {
  const expressionId = addExpression(attr.value, context);
  const cases: IrSwitchCase[] = [];
  let defaultFactoryId: number | undefined;

  for (const child of node.children) {
    if (child.kind !== 'element') continue;

    const literal = child.attrs.find(item => item.name === 'case');
    if (literal) {
      cases.push({
        factoryId: addViewFactory(cloneElementWithoutAttrs(child, ['case']), context),
        match: { type: 'literal', value: literal.value }
      });
      continue;
    }

    const bound = child.attrs.find(item => item.name === 'case.bind');
    if (bound) {
      cases.push({
        factoryId: addViewFactory(cloneElementWithoutAttrs(child, ['case.bind']), context),
        match: {
          type: 'expression',
          expressionId: addExpression(bound.value, context)
        }
      });
      continue;
    }

    if (child.attrs.some(item => item.name === 'default-case')) {
      defaultFactoryId = addViewFactory(cloneElementWithoutAttrs(child, ['default-case']), context);
    }
  }

  context.bindings.push({
    kind: 'templateController',
    controller: 'switch',
    path,
    expressionId,
    cases,
    ...(defaultFactoryId === undefined ? {} : { defaultFactoryId })
  });

  return { html: '<!--lami:switch-->' };
}

function buildPromiseController(
  node: AstElement,
  path: number[],
  attr: AstAttribute,
  context: BuildContext
): { html: string } {
  const expressionId = addExpression(attr.value, context);
  const branches: IrPromiseBranches = {};

  for (const child of node.children) {
    if (child.kind !== 'element') continue;

    if (child.attrs.some(item => item.name === 'pending')) {
      branches.pendingFactoryId = addViewFactory(cloneElementWithoutAttrs(child, ['pending']), context);
      continue;
    }

    const thenAttr = child.attrs.find(item => item.name === 'then');
    if (thenAttr) {
      branches.then = {
        local: thenAttr.value || 'value',
        factoryId: addViewFactory(cloneElementWithoutAttrs(child, ['then']), context)
      };
      continue;
    }

    const catchAttr = child.attrs.find(item => item.name === 'catch');
    if (catchAttr) {
      branches.catch = {
        local: catchAttr.value || 'error',
        factoryId: addViewFactory(cloneElementWithoutAttrs(child, ['catch']), context)
      };
    }
  }

  context.bindings.push({
    kind: 'templateController',
    controller: 'promise',
    path: [...path, 0],
    expressionId,
    promise: branches
  });

  const staticAttrs = controllerHostAttrs(node, attr.name);
  const attrs = staticAttrs.length ? ` ${staticAttrs.join(' ')}` : '';
  return { html: `<${node.tagName}${attrs}><!--lami:promise--></${node.tagName}>` };
}

function buildLetElement(node: AstElement, path: number[], context: BuildContext): { html: string } {
  const toBindingContext = node.attrs.some(attr => attr.name === 'to-binding-context');
  for (const attr of node.attrs) {
    if (attr.name === 'to-binding-context') continue;
    const syntax = attr.syntax;
    if (!isBindingCommand(syntax.command)) continue;

    context.bindings.push({
      kind: 'let',
      path,
      property: kebabToCamel(syntax.target),
      expressionId: addExpression(attr.value, context),
      toBindingContext
    });
  }

  return { html: '<!--lami:let-->' };
}

function addViewFactory(node: AstNode, context: BuildContext): number {
  const id = context.factories.length;
  const factoryContext = childContext();
  const staticHtml = buildNode(node, [0], factoryContext).html;
  context.factories.push({
    id,
    ast: node,
    staticHtml,
    expressions: factoryContext.expressions,
    bindings: factoryContext.bindings,
    factories: factoryContext.factories
  });
  return id;
}

function addExpression(source: string, context: BuildContext): number {
  const id = context.expressions.length;
  context.expressions.push({ id, source });
  return id;
}

function interpolationParts(value: string, context: BuildContext): IrInterpolationPart[] {
  return parseInterpolation(value).map(part => part.type === 'text'
    ? { type: 'text', value: part.value }
    : { type: 'expression', expressionId: addExpression(part.expression.source, context) });
}

function childContext(): BuildContext {
  return {
    expressions: [],
    bindings: [],
    factories: []
  };
}

function isIfElement(node: AstNode): node is AstElement {
  return node.kind === 'element' && node.attrs.some(attr => attr.name === 'if.bind');
}

function nextElseNode(nodes: AstNode[], index: number): { index: number; node: AstElement } | null {
  for (let cursor = index + 1; cursor < nodes.length; cursor++) {
    const node = nodes[cursor]!;
    if (node.kind === 'text' && node.value.trim() === '') continue;
    if (node.kind === 'element' && node.attrs.some(attr => attr.name === 'else')) {
      return { index: cursor, node };
    }
    return null;
  }

  return null;
}

function controllerAttr(node: AstElement): { name: IrTemplateControllerBinding['controller']; attr: AstAttribute } | null {
  const entries: Array<[IrTemplateControllerBinding['controller'], string]> = [
    ['if', 'if.bind'],
    ['repeat', 'repeat.for'],
    ['with', 'with.bind'],
    ['switch', 'switch.bind'],
    ['promise', 'promise.bind']
  ];

  for (const [name, attrName] of entries) {
    const attr = node.attrs.find(item => item.name === attrName);
    if (attr) return { name, attr };
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

function controllerHostAttrs(node: AstElement, controllerAttrName: string): string[] {
  const attrs: string[] = [];
  for (const attr of node.attrs) {
    if (attr.name === controllerAttrName) continue;
    if (attr.syntax.command !== null || hasInterpolation(attr.value) || isDirectiveAttr(attr.name)) continue;
    attrs.push(attr.value === '' ? attr.name : `${attr.name}="${escapeAttribute(attr.value)}"`);
  }
  return attrs;
}

function isBindingCommand(command: BindingCommandName): boolean {
  return command === 'bind' ||
    command === 'to-view' ||
    command === 'one-way' ||
    command === 'two-way' ||
    command === 'from-view' ||
    command === 'one-time' ||
    command === 'attr';
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

function resolveCompilerMode(command: BindingCommandName, tagName: string, target: string): BindingMode {
  switch (command) {
    case 'one-time': return BindingMode.oneTime;
    case 'from-view': return BindingMode.fromView;
    case 'two-way': return BindingMode.twoWay;
    case 'bind': return isDefaultTwoWayTarget(tagName, target) ? BindingMode.twoWay : BindingMode.toView;
    default: return BindingMode.toView;
  }
}

function isDefaultTwoWayTarget(tagName: string, target: string): boolean {
  return defaultTwoWayTargets.has(`${tagName.toUpperCase()}:${target}`);
}

function normalizeTarget(target: string): string {
  if (target === 'text') return 'textContent';
  if (target === 'value-as-number') return 'valueAsNumber';
  if (target === 'value-as-date') return 'valueAsDate';
  return target;
}

function kebabToCamel(value: string): string {
  return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, char => textEscapes[char]!);
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, char => attributeEscapes[char]!);
}

const defaultTwoWayTargets = new Set([
  'INPUT:value',
  'INPUT:valueAsNumber',
  'INPUT:valueAsDate',
  'INPUT:checked',
  'TEXTAREA:value',
  'SELECT:value',
  'SELECT:selectedIndex'
]);

const textEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;'
};

const attributeEscapes: Record<string, string> = {
  ...textEscapes,
  '"': '&quot;',
  "'": '&#39;'
};
