import type { Binding } from '../binding/binding.js';
import { BindingController, BindingMode, resolveMode } from '../binding/binding.js';
import {
  createBehaviorInstances,
  getBehaviorMode,
  getUpdateEvents,
  shouldForceAttribute
} from '../binding/behaviors.js';
import { EventBinding } from '../binding/event-binding.js';
import { InterpolationBinding, PropertyBinding } from '../binding/property-binding.js';
import { RefBinding } from '../binding/ref-binding.js';
import { SpreadBinding } from '../binding/spread-binding.js';
import {
  AttributeObserver,
  createTargetObserver,
  ObjectPropertyObserver,
  StylePropertyObserver,
  TokenClassObserver
} from '../binding/target-observer.js';
import { parseAttributeSyntax, parseCustomAttributeOptions } from './attributes.js';
import { hasInterpolation, parseInterpolation } from './interpolation.js';
import type { Expression, ExpressionNode, ExpressionOptions } from '../expression/ast.js';
import { collectBehaviorCalls, hasAssignment, parseExpression } from '../expression/evaluator.js';
import type { Scope } from '../expression/scope.js';
import type { AttributeDefinition, BindableDefinition, ElementDefinition, ResourceRegistry } from '../resources/registry.js';
import { reactive } from '../reactivity/reactive.js';
import { LetBinding } from '../template-controllers/let.js';
import { IfController } from '../template-controllers/if.js';
import { PromiseController, type PromiseBranches } from '../template-controllers/promise.js';
import { createRepeatLocals, materialize, parseRepeat, RepeatController } from '../template-controllers/repeat.js';
import { ShowController } from '../template-controllers/show.js';
import { SwitchController, type SwitchCase } from '../template-controllers/switch.js';
import { WithController } from '../template-controllers/with.js';
import type { View, ViewFactory } from '../template-controllers/view.js';
import { kebabToCamel } from '../util/casing.js';
import { childNodes, isElement, isText, removeAll } from '../util/dom.js';
import { LamiError } from '../util/errors.js';

const customAttributeInstances = new WeakMap<Element, Map<string, unknown>>();
const elementTemplateCache = new WeakMap<ElementDefinition, WeakMap<Document, HTMLTemplateElement>>();
const elementSlotPathCache = new WeakMap<ElementDefinition, WeakMap<Document, SlotPath[]>>();
const templateSlotPathCache = new WeakMap<HTMLTemplateElement, SlotPath[]>();

export interface RuntimeCompileOptions extends ExpressionOptions {
  resources: ResourceRegistry;
  projectedScopes?: WeakMap<Node, Scope | null>;
}

export interface RuntimeView extends View {
  dispose(): void;
}

interface WalkContext {
  options: RuntimeCompileOptions;
  projectedScopes?: WeakMap<Node, Scope | null>;
  nextBindingId(): number;
  add(binding: Binding): void;
}

interface SlotPath {
  path: number[];
  name: string;
}

export function compileAndBindRoot(
  root: Element | DocumentFragment,
  scope: Scope,
  resources: ResourceRegistry,
  options: Omit<RuntimeCompileOptions, 'resources'> = {}
): RuntimeView {
  const view = new DomView(root instanceof DocumentFragment ? childNodes(root) : [root], scope, {
    ...options,
    resources
  });
  view.compile();
  view.bind();
  return view;
}

export class DomView implements RuntimeView {
  private bindings: Binding[] = [];
  private compiled = false;
  private bound = false;

  readonly first: Node;
  readonly last: Node;

  constructor(
    private readonly nodes: Node[],
    public readonly scope: Scope,
    private readonly options: RuntimeCompileOptions
  ) {
    this.first = nodes[0] ?? document.createComment('empty');
    this.last = nodes[nodes.length - 1] ?? this.first;
  }

  compile(): void {
    if (this.compiled) return;
    this.compiled = true;
    let id = 0;
    const context: WalkContext = {
      options: this.options,
      nextBindingId: () => ++id,
      add: binding => {
        if (binding instanceof BindingController) {
          binding.setDiagnostics(this.options);
        }
        this.bindings.push(binding);
      },
      ...(this.options.projectedScopes ? { projectedScopes: this.options.projectedScopes } : {})
    };

    for (const node of [...this.nodes]) {
      walkNode(node, this.scope, context);
    }
  }

  bind(): void {
    this.compile();
    if (this.bound) return;
    this.bound = true;
    for (const binding of this.bindings) {
      this.runBindingLifecycle(binding, 'bind', () => binding.bind());
    }
  }

  refresh(): void {
    for (const binding of this.bindings) {
      this.runBindingLifecycle(binding, 'refresh', () => binding.refresh());
    }
  }

  unbind(): void {
    if (!this.bound) return;
    for (let index = this.bindings.length - 1; index >= 0; index--) {
      const binding = this.bindings[index]!;
      this.runBindingLifecycle(binding, 'unbind', () => binding.unbind());
    }
    this.bound = false;
  }

  dispose(): void {
    this.unbind();
    this.remove();
  }

  remove(): void {
    removeAll(this.nodes);
  }

  moveBefore(reference: Node): void {
    const parent = reference.parentNode;
    if (!parent) return;
    for (const node of this.nodes) {
      parent.insertBefore(node, reference);
    }
  }

  appendTo(parent: Node): void {
    for (const node of this.nodes) {
      parent.appendChild(node);
    }
  }

  updateLocals(locals: Record<string, unknown>): void {
    for (const key of Object.keys(this.scope.locals)) {
      if (!(key in locals)) delete this.scope.locals[key];
    }
    for (const [key, value] of Object.entries(locals)) {
      this.scope.locals[key] = value;
    }
  }

  private runBindingLifecycle(binding: Binding, phase: string, callback: () => void): void {
    if (binding instanceof BindingController) {
      binding.runWithDiagnostics(phase, callback, {
        bindingId: binding.id,
        bindingMode: binding.mode
      });
      return;
    }
    callback();
  }
}

export function createElementViewFactory(
  element: Element,
  options: RuntimeCompileOptions,
  removeAttributes: string[]
): ViewFactory {
  const clone = element.cloneNode(true) as Element;
  for (const attr of removeAttributes) {
    clone.removeAttribute(attr);
  }

  return {
    create(scope) {
      const node = clone.cloneNode(true);
      const view = new DomView([node], scope, options);
      view.compile();
      return view;
    }
  };
}

export function createNodeViewFactory(
  nodes: Node[],
  options: RuntimeCompileOptions,
  removeAttributes: string[] = []
): ViewFactory {
  const clones = nodes.map(node => {
    const clone = node.cloneNode(true);
    if (clone instanceof Element) {
      for (const attr of removeAttributes) clone.removeAttribute(attr);
    }
    return clone;
  });

  return {
    create(scope) {
      const nodes = clones.map(node => node.cloneNode(true));
      const view = new DomView(nodes, scope, options);
      view.compile();
      return view;
    }
  };
}

function walkNode(node: Node, scope: Scope, context: WalkContext): void {
  if (context.projectedScopes?.has(node)) {
    const projectedScope = context.projectedScopes.get(node);
    if (projectedScope === null) return;

    const { projectedScopes: _projectedScopes, ...nextContext } = context;
    walkNode(node, projectedScope!, nextContext);
    return;
  }

  if (isText(node)) {
    processText(node, scope, context);
    return;
  }

  if (!isElement(node)) return;
  if (processElementControllers(node, scope, context)) return;
  if (processCustomElement(node, scope, context)) return;
  processElementBindings(node, scope, context);

  for (const child of childNodes(node)) {
    walkNode(child, scope, context);
  }
}

function processText(node: Text, scope: Scope, context: WalkContext): void {
  if (!hasInterpolation(node.data)) return;
  const parts = parseInterpolation(node.data, context.options);
  assertInterpolationIsToViewSafe(parts, context, 'text interpolation');
  context.add(new InterpolationBinding(
    context.nextBindingId(),
    parts,
    value => {
      node.data = value;
    },
    scope
  ));
}

function processElementControllers(element: Element, scope: Scope, context: WalkContext): boolean {
  if (element.tagName === 'LET') {
    processLetElement(element, scope, context);
    element.remove();
    return true;
  }

  const switchAttr = getAttribute(element, 'switch.bind');
  if (switchAttr) {
    processSwitch(element, switchAttr.value, scope, context);
    return true;
  }

  const promiseAttr = getAttribute(element, 'promise.bind');
  if (promiseAttr) {
    processPromise(element, promiseAttr.value, scope, context);
    return true;
  }

  const withAttr = getAttribute(element, 'with.bind');
  if (withAttr) {
    processWith(element, withAttr.value, scope, context);
    return true;
  }

  const ifAttr = getAttribute(element, 'if.bind');
  if (ifAttr) {
    processIf(element, ifAttr.value, scope, context);
    return true;
  }

  const repeatAttr = getAttribute(element, 'repeat.for');
  if (repeatAttr) {
    processRepeat(element, repeatAttr.value, scope, context);
    return true;
  }

  return false;
}

function processElementBindings(element: Element, scope: Scope, context: WalkContext): void {
  const show = getAttribute(element, 'show.bind');
  if (show && element instanceof HTMLElement) {
    context.add(new ShowController(
      context.nextBindingId(),
      element,
      parseExpression(show.value, context.options),
      scope
    ));
    element.removeAttribute(show.name);
  }

  const hide = getAttribute(element, 'hide.bind');
  if (hide && element instanceof HTMLElement) {
    context.add(new ShowController(
      context.nextBindingId(),
      element,
      parseExpression(hide.value, context.options),
      scope,
      true
    ));
    element.removeAttribute(hide.name);
  }

  const attrs = Array.from(element.attributes);

  for (const attr of attrs) {
    if (!element.hasAttribute(attr.name)) continue;
    const syntax = parseAttributeSyntax(attr.name, attr.value);

    if (syntax.rawName.startsWith('...')) {
      const source = syntax.target === '$bindables' ? attr.value : kebabToCamel(syntax.target);
      context.add(new SpreadBinding(
        context.nextBindingId(),
        element,
        parseExpression(source, context.options),
        scope
      ));
      element.removeAttribute(attr.name);
      continue;
    }

    if (syntax.rawName === 'else') {
      element.removeAttribute(attr.name);
      continue;
    }

    if (syntax.rawName === 'ref' || syntax.command === 'ref') {
      context.add(new RefBinding(
        context.nextBindingId(),
        attr.value || syntax.target,
        resolveRefValue(element, syntax.target, scope, context),
        scope
      ));
      element.removeAttribute(attr.name);
      continue;
    }

    const customAttribute = syntax.command === null
      ? context.options.resources.getAttribute(syntax.target)
      : undefined;
    if (customAttribute) {
      processCustomAttribute(element, attr, customAttribute, scope, context);
      element.removeAttribute(attr.name);
      continue;
    }

    if (syntax.command === 'trigger' || syntax.command === 'capture') {
      const { expression, behaviors } = parseBindingValue(attr.value, context);
      context.add(new EventBinding(context.nextBindingId(), element, syntax, expression, scope, behaviors));
      element.removeAttribute(attr.name);
      continue;
    }

    if (syntax.command === 'class') {
      const { expression, behaviors } = parseBindingValue(attr.value, context);
      context.add(new PropertyBinding(
        context.nextBindingId(),
        BindingMode.toView,
        expression,
        new TokenClassObserver(element, syntax.target.split(',').filter(Boolean)),
        scope,
        behaviors
      ));
      element.removeAttribute(attr.name);
      continue;
    }

    if (syntax.command === 'style') {
      const { expression, behaviors } = parseBindingValue(attr.value, context);
      context.add(new PropertyBinding(
        context.nextBindingId(),
        BindingMode.toView,
        expression,
        new StylePropertyObserver(element, syntax.target),
        scope,
        behaviors
      ));
      element.removeAttribute(attr.name);
      continue;
    }

    if (isBindingCommand(syntax.command)) {
      if (hasInterpolation(attr.value)) {
        throw new LamiError('E_EXPR_PARSE', `Do not use interpolation inside ${attr.name}`);
      }

      const { expression, behaviors } = parseBindingValue(attr.value, context);
      const forceAttribute = syntax.command === 'attr' || shouldForceAttribute(behaviors);
      const mode = resolveMode(syntax.command, element, normalizeBindingTarget(syntax.target), getBehaviorMode(behaviors));
      assertExpressionModeIsSafe(expression, mode, context, attr.name);
      context.add(new PropertyBinding(
        context.nextBindingId(),
        mode,
        expression,
        createObserver(element, syntax.target, observerOptions(forceAttribute, getUpdateEvents(behaviors, scope), context.options.dev)),
        scope,
        behaviors
      ));
      element.removeAttribute(attr.name);
      continue;
    }

    if (syntax.command === null && hasInterpolation(attr.value)) {
      const parts = parseInterpolation(attr.value, context.options);
      assertInterpolationIsToViewSafe(parts, context, attr.name);
      const observer = new AttributeObserver(element, attr.name);
      context.add(new InterpolationBinding(
        context.nextBindingId(),
        parts,
        value => observer.write(value),
        scope
      ));
    }
  }

}

function processCustomAttribute(
  element: Element,
  attr: Attr,
  definition: AttributeDefinition,
  scope: Scope,
  context: WalkContext
): void {
  const instance = new definition.Type(element, {});
  const controller = new ResourceLifecycleBinding(
    context.nextBindingId(),
    instance as Record<string, unknown>,
    []
  );
  rememberCustomAttribute(element, definition, instance);

  const instructions = parseCustomAttributeOptions(
    definition.emptyAsTrue && attr.value === '' ? 'true' : attr.value,
    definition.defaultProperty ?? 'value'
  );

  for (const instruction of instructions) {
    const bindable = findBindable(definition.bindables, instruction.property);
    const property = bindable.property;
    const target = new ObjectPropertyObserver(
      instance as Record<string, unknown>,
      property,
      bindable.definition?.set
    );

    if (instruction.command) {
      const { expression, behaviors } = parseBindingValue(instruction.expression, context);
      controller.children.push(new PropertyBinding(
        context.nextBindingId(),
        bindable.definition?.mode ?? resolveMode(instruction.command, element, property),
        expression,
        target,
        scope,
        behaviors
      ));
    } else if (hasInterpolation(instruction.expression)) {
      controller.children.push(new InterpolationBinding(
        context.nextBindingId(),
        parseInterpolation(instruction.expression, context.options),
        value => target.write(value),
        scope
      ));
    } else {
      controller.children.push(new PropertyBinding(
        context.nextBindingId(),
        BindingMode.oneTime,
        literalExpression(instruction.expression),
        target,
        scope
      ));
    }
  }

  context.add(controller);
}

function processCustomElement(element: Element, scope: Scope, context: WalkContext): boolean {
  const definition = context.options.resources.getElement(element.tagName.toLowerCase());
  if (!definition) return false;

  const instance = reactive(new definition.Type() as Record<string, unknown>);
  const childScope = scope.withContext(instance);
  const hostBindings: Binding[] = [];
  const pendingRefs: Array<{ property: string; target: string }> = [];
  const lightChildren = childNodes(element);

  for (const attr of Array.from(element.attributes)) {
    const syntax = parseAttributeSyntax(attr.name, attr.value);

    if (syntax.rawName === 'ref' || syntax.command === 'ref') {
      pendingRefs.push({ property: attr.value || syntax.target, target: syntax.target });
      element.removeAttribute(attr.name);
      continue;
    }

    const bindable = findBindable(definition.bindables, syntax.target);
    if (!bindable.definition) continue;

    const target = new ObjectPropertyObserver(instance, bindable.property, bindable.definition.set);
    if (isBindingCommand(syntax.command)) {
      const { expression, behaviors } = parseBindingValue(attr.value, context);
      hostBindings.push(new PropertyBinding(
        context.nextBindingId(),
        bindable.definition.mode ?? resolveMode(syntax.command, element, bindable.property),
        expression,
        target,
        scope,
        behaviors
      ));
    } else if (hasInterpolation(attr.value)) {
      hostBindings.push(new InterpolationBinding(
        context.nextBindingId(),
        parseInterpolation(attr.value, context.options),
        value => target.write(value),
        scope
      ));
    } else {
      target.write(attr.value);
    }
    element.removeAttribute(attr.name);
  }

  const rendered = renderElementTemplate(element, definition, lightChildren);
  const lifecycle = new ResourceLifecycleBinding(
    context.nextBindingId(),
    instance,
    hostBindings
  );
  context.add(lifecycle);
  for (const ref of pendingRefs) {
    context.add(new RefBinding(
      context.nextBindingId(),
      ref.property,
      resolveCustomElementRef(ref.target, element, instance, lifecycle),
      scope
    ));
  }

  if (definition.shadow === 'open') {
    for (const child of lightChildren) {
      walkNode(child, scope, context);
    }
  }

  const templateContext = rendered.projected.length > 0
    ? {
        ...context,
        projectedScopes: projectedScopeMap(rendered.projected, scope)
      }
    : context;

  for (const child of childNodes(rendered.root)) {
    walkNode(child, childScope, templateContext);
  }

  return true;
}

function processLetElement(element: Element, scope: Scope, context: WalkContext): void {
  const toBindingContext = element.hasAttribute('to-binding-context');
  for (const attr of Array.from(element.attributes)) {
    if (attr.name === 'to-binding-context') continue;
    const syntax = parseAttributeSyntax(attr.name, attr.value);
    if (!isBindingCommand(syntax.command)) continue;

    context.add(new LetBinding(
      context.nextBindingId(),
      kebabToCamel(syntax.target),
      parseExpression(attr.value, context.options),
      scope,
      toBindingContext
    ));
  }
}

function processIf(element: Element, expressionSource: string, scope: Scope, context: WalkContext): void {
  const parent = element.parentNode;
  if (!parent) return;

  const anchor = element.ownerDocument.createComment('lami:if');
  const elseElement = nextElseElement(element);
  const ifFactory = createElementViewFactory(element, context.options, ['if.bind']);
  const elseFactory = elseElement
    ? createElementViewFactory(elseElement, context.options, ['else'])
    : null;

  parent.insertBefore(anchor, element);
  element.remove();
  elseElement?.remove();

  context.add(new IfController(
    context.nextBindingId(),
    parseExpression(expressionSource, context.options),
    scope,
    ifFactory,
    elseFactory,
    anchor
  ));
}

function processWith(element: Element, expressionSource: string, scope: Scope, context: WalkContext): void {
  const parent = element.parentNode;
  if (!parent) return;

  const anchor = element.ownerDocument.createComment('lami:with');
  const factory = createElementViewFactory(element, context.options, ['with.bind']);

  parent.insertBefore(anchor, element);
  element.remove();

  context.add(new WithController(
    context.nextBindingId(),
    parseExpression(expressionSource, context.options),
    scope,
    factory,
    anchor
  ));
}

function processSwitch(element: Element, expressionSource: string, scope: Scope, context: WalkContext): void {
  const parent = element.parentNode;
  if (!parent) return;

  const anchor = element.ownerDocument.createComment('lami:switch');
  const cases: SwitchCase[] = [];
  let defaultCase: SwitchCase | null = null;
  const sourceNodes = element instanceof HTMLTemplateElement
    ? childNodes(element.content)
    : childNodes(element);

  for (const child of sourceNodes) {
    if (!(child instanceof Element)) continue;

    if (child.hasAttribute('case')) {
      const value = child.getAttribute('case') ?? '';
      cases.push({
        factory: createNodeViewFactory([child], context.options, ['case']),
        matches: switchValue => Object.is(String(switchValue), value)
      });
      continue;
    }

    if (child.hasAttribute('case.bind')) {
      const expression = parseExpression(child.getAttribute('case.bind') ?? '', context.options);
      cases.push({
        factory: createNodeViewFactory([child], context.options, ['case.bind']),
        matches: switchValue => {
          const caseValue = expression.evaluate(scope);
          return Array.isArray(caseValue)
            ? caseValue.some(value => Object.is(value, switchValue))
            : Object.is(caseValue, switchValue);
        }
      });
      continue;
    }

    if (child.hasAttribute('default-case')) {
      defaultCase = {
        factory: createNodeViewFactory([child], context.options, ['default-case']),
        matches: () => false
      };
    }
  }

  parent.insertBefore(anchor, element);
  element.remove();

  context.add(new SwitchController(
    context.nextBindingId(),
    parseExpression(expressionSource, context.options),
    scope,
    cases,
    defaultCase,
    anchor
  ));
}

function processPromise(element: Element, expressionSource: string, scope: Scope, context: WalkContext): void {
  const anchor = element.ownerDocument.createComment('lami:promise');
  const branches: PromiseBranches = {};
  const sourceNodes = childNodes(element);

  for (const child of sourceNodes) {
    if (!(child instanceof Element)) {
      child.parentNode?.removeChild(child);
      continue;
    }

    if (child.hasAttribute('pending')) {
      branches.pending = createNodeViewFactory([child], context.options, ['pending']);
      child.remove();
      continue;
    }

    if (child.hasAttribute('then')) {
      branches.then = {
        local: child.getAttribute('then') || 'value',
        factory: createNodeViewFactory([child], context.options, ['then'])
      };
      child.remove();
      continue;
    }

    if (child.hasAttribute('catch')) {
      branches.catch = {
        local: child.getAttribute('catch') || 'error',
        factory: createNodeViewFactory([child], context.options, ['catch'])
      };
      child.remove();
    }
  }

  element.append(anchor);
  element.removeAttribute('promise.bind');
  context.add(new PromiseController(
    context.nextBindingId(),
    parseExpression(expressionSource, context.options),
    scope,
    branches,
    anchor
  ));
}

function processRepeat(element: Element, expressionSource: string, scope: Scope, context: WalkContext): void {
  const parent = element.parentNode;
  if (!parent) return;

  const anchor = element.ownerDocument.createComment('lami:repeat');
  const factory = createElementViewFactory(element, context.options, ['repeat.for']);
  const definition = parseRepeat(expressionSource);

  parent.insertBefore(anchor, element);
  element.remove();

  context.add(new RepeatController(
    context.nextBindingId(),
    definition,
    parseExpression(definition.items, context.options),
    definition.key ? parseExpression(definition.key, context.options) : null,
    scope,
    factory,
    anchor
  ));
}

function parseBindingValue(value: string, context: WalkContext) {
  const expression = parseExpression(value, context.options);
  const behaviorCalls = collectBehaviorCalls(expression.ast);
  const behaviors = createBehaviorInstances(behaviorCalls, context.options.resources);
  return { expression, behaviors };
}

function assertExpressionModeIsSafe(
  expression: Expression,
  mode: BindingMode,
  context: WalkContext,
  source: string
): void {
  if (!context.options.dev) return;
  if (mode !== BindingMode.toView && mode !== BindingMode.oneTime) return;
  if (!hasAssignment(expression.ast)) return;

  throw new LamiError('E_EXPR_ASSIGN', `Assignment is not allowed in to-view binding "${source}"`);
}

function assertInterpolationIsToViewSafe(
  parts: ReturnType<typeof parseInterpolation>,
  context: WalkContext,
  source: string
): void {
  if (!context.options.dev) return;
  for (const part of parts) {
    if (part.type === 'expression' && hasAssignment(part.expression.ast)) {
      throw new LamiError('E_EXPR_ASSIGN', `Assignment is not allowed in ${source}`);
    }
  }
}

function createObserver(
  element: Element,
  rawTarget: string,
  options: { forceAttribute: boolean; updateEvents?: string[]; dev?: boolean }
) {
  if (rawTarget.startsWith('style.')) {
    return new StylePropertyObserver(element, rawTarget.slice('style.'.length));
  }
  return createTargetObserver(element, normalizeBindingTarget(rawTarget), options);
}

function normalizeBindingTarget(target: string): string {
  if (target === 'text') return 'textContent';
  if (target === 'value-as-number') return 'valueAsNumber';
  if (target === 'value-as-date') return 'valueAsDate';
  return target;
}

function observerOptions(forceAttribute: boolean, updateEvents: string[] | undefined, dev: boolean | undefined): { forceAttribute: boolean; updateEvents?: string[]; dev?: boolean } {
  const options: { forceAttribute: boolean; updateEvents?: string[]; dev?: boolean } = { forceAttribute };
  if (updateEvents) options.updateEvents = updateEvents;
  if (dev !== undefined) options.dev = dev;
  return options;
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

function getAttribute(element: Element, name: string): Attr | null {
  return Array.from(element.attributes).find(attr => attr.name === name) ?? null;
}

function rememberCustomAttribute(element: Element, definition: AttributeDefinition, instance: unknown): void {
  let instances = customAttributeInstances.get(element);
  if (!instances) {
    instances = new Map();
    customAttributeInstances.set(element, instances);
  }

  instances.set(definition.name.toLowerCase(), instance);
  for (const alias of definition.aliases ?? []) {
    instances.set(alias.toLowerCase(), instance);
  }
}

function resolveRefValue(element: Element, target: string, scope: Scope, context: WalkContext): unknown {
  if (target === 'ref') return element;
  if (target === 'element') return element;
  if (target === 'component' || target === 'controller') return element;

  const definition = context.options.resources.getAttribute(target);
  if (!definition) return element;

  let instance = customAttributeInstances.get(element)?.get(definition.name.toLowerCase());
  if (instance) return instance;

  const sourceAttribute = getAttribute(element, target);
  if (!sourceAttribute) return element;

  processCustomAttribute(element, sourceAttribute, definition, scope, context);
  element.removeAttribute(sourceAttribute.name);
  instance = customAttributeInstances.get(element)?.get(definition.name.toLowerCase());
  return instance ?? element;
}

function resolveCustomElementRef(
  target: string,
  element: Element,
  instance: unknown,
  controller: Binding
): unknown {
  if (target === 'controller') return controller;
  if (target === 'component') return instance;
  return element;
}

function nextElseElement(element: Element): Element | null {
  let cursor = element.nextSibling;
  while (cursor && cursor.nodeType === Node.TEXT_NODE && cursor.textContent?.trim() === '') {
    cursor = cursor.nextSibling;
  }

  return cursor instanceof Element && cursor.hasAttribute('else') ? cursor : null;
}

export { createRepeatLocals, materialize };

class ResourceLifecycleBinding extends BindingController {
  constructor(
    id: number,
    private readonly instance: Record<string, unknown>,
    public readonly children: Binding[]
  ) {
    super(id, BindingMode.oneTime);
  }

  bind(): void {
    callLifecycle(this.instance, 'binding');
    for (const child of this.children) child.bind();
    callLifecycle(this.instance, 'bound');
    callLifecycle(this.instance, 'attaching');
    callLifecycle(this.instance, 'attached');
  }

  refresh(): void {
    for (const child of this.children) child.refresh();
  }

  override unbind(): void {
    callLifecycle(this.instance, 'detaching');
    for (let index = this.children.length - 1; index >= 0; index--) {
      this.children[index]!.unbind();
    }
    callLifecycle(this.instance, 'unbinding');
    super.unbind();
  }
}

function callLifecycle(instance: Record<string, unknown>, name: string): void {
  const callback = instance[name];
  if (typeof callback === 'function') {
    callback.call(instance);
  }
}

function findBindable(
  bindables: Record<string, BindableDefinition> | undefined,
  requested: string
): { property: string; definition?: BindableDefinition } {
  const camel = kebabToCamel(requested);
  const definition = bindables?.[requested] ?? bindables?.[camel];
  return {
    property: definition?.property ?? camel,
    ...(definition ? { definition } : {})
  };
}

function literalExpression(value: unknown): Expression {
  const ast: ExpressionNode = { type: 'Literal', value };
  return {
    source: String(value),
    ast,
    evaluate: () => value
  };
}

interface RenderedElementTemplate {
  root: Element | ShadowRoot;
  projected: Node[];
}

function renderElementTemplate(
  element: Element,
  definition: ElementDefinition,
  lightChildren: Node[]
): RenderedElementTemplate {
  const root = definition.shadow === 'open'
    ? element.shadowRoot ?? element.attachShadow({ mode: 'open' })
    : element;

  while (root.firstChild) {
    root.removeChild(root.firstChild);
  }

  const fragment = cloneElementTemplate(definition, element.ownerDocument);
  const projected = definition.shadow === 'open'
    ? []
    : projectSlots(fragment, lightChildren, elementSlotPaths(definition, element.ownerDocument));
  root.append(fragment);
  return { root, projected };
}

function projectSlots(fragment: DocumentFragment, lightChildren: Node[], slotPaths: SlotPath[]): Node[] {
  const slots = slotPaths
    .map(({ path, name }) => ({ slot: nodeAtPath(fragment, path), name }))
    .filter((entry): entry is { slot: Element; name: string } => entry.slot instanceof Element && entry.slot.tagName.toLowerCase() === 'slot');
  if (slots.length === 0) return [];

  const groups = new Map<string, Node[]>();
  for (const child of lightChildren) {
    const name = child instanceof Element ? child.getAttribute('slot') ?? '' : '';
    let group = groups.get(name);
    if (!group) {
      group = [];
      groups.set(name, group);
    }
    group.push(child);
  }

  const projected: Node[] = [];
  for (const { slot, name } of slots) {
    const assigned = groups.get(name) ?? [];
    if (assigned.length > 0) {
      projected.push(...assigned);
      slot.replaceWith(...assigned);
      continue;
    }

    slot.replaceWith(...childNodes(slot));
  }

  return projected;
}

function elementSlotPaths(definition: ElementDefinition, ownerDocument: Document): SlotPath[] {
  if (typeof definition.template !== 'string') {
    let paths = templateSlotPathCache.get(definition.template);
    if (!paths) {
      paths = collectSlotPaths(definition.template.content);
      templateSlotPathCache.set(definition.template, paths);
    }
    return paths;
  }

  let documents = elementSlotPathCache.get(definition);
  if (!documents) {
    documents = new WeakMap();
    elementSlotPathCache.set(definition, documents);
  }

  let paths = documents.get(ownerDocument);
  if (!paths) {
    paths = collectSlotPaths(elementTemplate(definition, ownerDocument).content);
    documents.set(ownerDocument, paths);
  }
  return paths;
}

function collectSlotPaths(parent: ParentNode, parentPath: number[] = [], paths: SlotPath[] = []): SlotPath[] {
  const nodes = Array.from(parent.childNodes);
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    const path = [...parentPath, index];
    if (!(node instanceof Element)) continue;
    if (node.tagName.toLowerCase() === 'slot') {
      paths.push({
        path,
        name: node.getAttribute('name') ?? ''
      });
    }
    collectSlotPaths(node, path, paths);
  }
  return paths;
}

function nodeAtPath(root: Node, path: number[]): Node | null {
  let current: Node | null = root;
  for (const index of path) {
    current = current?.childNodes[index] ?? null;
    if (!current) return null;
  }
  return current;
}

function projectedScopeMap(nodes: Node[], scope: Scope): WeakMap<Node, Scope | null> {
  const scopes = new WeakMap<Node, Scope | null>();
  for (const node of nodes) scopes.set(node, scope);
  return scopes;
}

function cloneElementTemplate(definition: ElementDefinition, ownerDocument: Document): DocumentFragment {
  if (typeof definition.template !== 'string') {
    return definition.template.content.cloneNode(true) as DocumentFragment;
  }

  return elementTemplate(definition, ownerDocument).content.cloneNode(true) as DocumentFragment;
}

function elementTemplate(definition: ElementDefinition, ownerDocument: Document): HTMLTemplateElement {
  if (typeof definition.template !== 'string') {
    return definition.template;
  }

  let documents = elementTemplateCache.get(definition);
  if (!documents) {
    documents = new WeakMap();
    elementTemplateCache.set(definition, documents);
  }

  let template = documents.get(ownerDocument);
  if (!template) {
    template = ownerDocument.createElement('template');
    template.innerHTML = definition.template;
    documents.set(ownerDocument, template);
  }

  return template;
}
