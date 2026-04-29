import { RefBinding } from '../binding/ref-binding.js';
import { SpreadBinding } from '../binding/spread-binding.js';
import { EventBinding, addOptimizedEventListener } from '../binding/event-binding.js';
import { InterpolationBinding, PropertyBinding } from '../binding/property-binding.js';
import { BindingController, BindingMode, resolveMode, type Binding } from '../binding/binding.js';
import {
  createTargetObserver,
  AttributeObserver,
  StylePropertyObserver,
  TokenClassObserver,
  writeAttribute,
  writeProperty,
  type TargetObserverOptions
} from '../binding/target-observer.js';
import {
  createBehaviorInstances,
  getBehaviorMode,
  getUpdateEvents,
  registerBuiltInBehaviors,
  shouldForceAttribute
} from '../binding/behaviors.js';
import { parseExpression, collectBehaviorCalls, hasAssignment } from '../expression/evaluator.js';
import type { BehaviorCall, Expression, ExpressionNode, ExpressionOptions } from '../expression/ast.js';
import { getIdentifier, Scope } from '../expression/scope.js';
import { effect, type EffectHandle } from '../reactivity/effect.js';
import { markRaw, reactive } from '../reactivity/reactive.js';
import { flushJobs } from '../reactivity/scheduler.js';
import { IfController } from '../template-controllers/if.js';
import { LetBinding } from '../template-controllers/let.js';
import { PromiseController, type PromiseBranches } from '../template-controllers/promise.js';
import { materialize, parseRepeat, RepeatController, type RepeatDefinition } from '../template-controllers/repeat.js';
import { ShowController } from '../template-controllers/show.js';
import { SwitchController, type SwitchCase } from '../template-controllers/switch.js';
import type { View, ViewFactory } from '../template-controllers/view.js';
import { WithController } from '../template-controllers/with.js';
import { childNodes, removeAll } from '../util/dom.js';
import type { Cleanup } from '../util/dom.js';
import { ValueSlot } from '../util/equality.js';
import {
  createResourceRegistry,
  type BindableDefinition,
  type ElementDefinition,
  type ResourceRegistry,
  type ResourceRegistryInit
} from '../resources/registry.js';
import { parseAttributeSyntax, type AttributeSyntax } from './attributes.js';
import { hasInterpolation, parseInterpolation, type InterpolationPart } from './interpolation.js';
import { LamiError, reportError, type LamiWarning } from '../util/errors.js';
import { kebabToCamel } from '../util/casing.js';
import { DomView, type RuntimeCompileOptions } from './dom-walker.js';

export interface CompiledMountOptions {
  resources?: ResourceRegistry | ResourceRegistryInit;
  dev?: boolean;
  onError?: (error: LamiError) => void;
  onWarn?: (warning: LamiWarning) => void;
  clearRootOnDispose?: boolean;
}

export interface CompiledBindingHost {
  readonly scope: Scope;
  readonly resources: ResourceRegistry;
  readonly dev?: boolean;
  readonly onError?: (error: LamiError) => void;
  readonly onWarn?: (warning: LamiWarning) => void;
  readonly bindings: Binding[];
  add(binding: Binding): Binding;
}

export interface CompiledApp extends CompiledBindingHost {
  root: Element | DocumentFragment;
  bind(): void;
  dispose(): void;
  flush(): Promise<void>;
}

export interface CompiledView extends CompiledBindingHost, View {}

export interface OptimizedCompiledView extends CompiledView {
  addRefresh(refresh: () => void): void;
  onDispose(cleanup: Cleanup): void;
}

export interface OptimizedRepeatRow {
  readonly first: Node;
  readonly last: Node;
  readonly scope: Scope;
  setRefresh(refresh: () => void): void;
  onBind(callback: () => Cleanup | void): void;
  onDispose(cleanup: Cleanup): void;
}

export type OptimizedRepeatRowFactory = () => OptimizedRepeatRow;

export type CompiledViewBinder = (view: CompiledView, fragment: DocumentFragment) => void;

export type CompiledSwitchCase =
  | { factory: ViewFactory; value: string }
  | { factory: ViewFactory; source: string };

export interface CompiledPromiseBranches {
  pending?: ViewFactory;
  then?: {
    local: string;
    factory: ViewFactory;
  };
  catch?: {
    local: string;
    factory: ViewFactory;
  };
}

export type CompiledInterpolationPart =
  | { type: 'text'; value: string }
  | { type: 'expression'; source: CompiledExpressionInput };

export type CompiledExpressionInput = string | CompiledExpressionDefinition;

export interface CompiledExpressionDefinition {
  source: string;
  evaluate(scope: Scope): unknown;
  assign?(scope: Scope, value: unknown): void;
}

export function createTemplate(html: string, ownerDocument: Document = document): { clone(): DocumentFragment; cloneFirstChild(): ChildNode } {
  const template = ownerDocument.createElement('template');
  template.innerHTML = html;
  return {
    clone() {
      return template.content.cloneNode(true) as DocumentFragment;
    },
    cloneFirstChild() {
      return template.content.firstChild!.cloneNode(true) as ChildNode;
    }
  };
}

export function createCompiledApp<T extends object>(
  root: Element | DocumentFragment,
  model: T,
  options: CompiledMountOptions = {}
): CompiledApp {
  const resources = createResourceRegistry(options.resources);
  registerBuiltInBehaviors(resources);
  const app: CompiledApp = {
    root,
    scope: new Scope(reactive(model)),
    resources,
    ...(options.dev === undefined ? {} : { dev: options.dev }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.onWarn === undefined ? {} : { onWarn: options.onWarn }),
    bindings: [],
    add(binding) {
      if (binding instanceof BindingController) {
        binding.setDiagnostics(this);
      }
      this.bindings.push(binding);
      return binding;
    },
    bind() {
      for (const binding of this.bindings) {
        runBindingLifecycle(this, binding, 'bind', () => binding.bind());
      }
    },
    dispose() {
      const clearRoot = options.clearRootOnDispose === true;
      if (clearRoot) rootDisposeDepth++;
      try {
        for (let index = this.bindings.length - 1; index >= 0; index--) {
          const binding = this.bindings[index]!;
          runBindingLifecycle(this, binding, 'unbind', () => binding.unbind());
        }
        this.bindings.length = 0;
      } finally {
        if (clearRoot) rootDisposeDepth--;
      }
      if (clearRoot) {
        clearRootChildren(root);
      }
    },
    flush: flushJobs
  };

  return app;
}

let rootDisposeDepth = 0;

export function createCompiledViewFactory(
  host: CompiledBindingHost,
  template: { clone(): DocumentFragment },
  bindView: CompiledViewBinder
): ViewFactory {
  return {
    create(scope) {
      const fragment = template.clone();
      const nodes = childNodes(fragment);
      const view = new CompiledTemplateView(nodes, scope, host.resources, host);
      bindView(view, fragment);
      return view;
    }
  };
}

export function createOptimizedRepeatRow(
  host: CompiledBindingHost,
  fragment: DocumentFragment
): OptimizedRepeatRow {
  return createOptimizedRepeatRowFromNodes(host, childNodes(fragment));
}

export function createOptimizedRepeatRowFromNodes(
  host: CompiledBindingHost,
  nodes: Node[]
): OptimizedRepeatRow {
  return new OptimizedCompiledRepeatRow(nodes, createOptimizedRepeatScope(host.scope));
}

export function bindTextCompiled(
  app: CompiledBindingHost,
  node: Text,
  parts: CompiledInterpolationPart[]
): Binding {
  return app.add(new InterpolationBinding(
    app.bindings.length + 1,
    compileInterpolationParts(parts, app),
    value => {
      node.data = value;
    },
    app.scope
  ));
}

export function bindTextOptimizedCompiled(
  view: OptimizedCompiledView,
  node: Text,
  parts: CompiledInterpolationPart[]
): void {
  const expressions = compileInterpolationParts(parts, view);
  const slot = new ValueSlot<string>();
  view.addRefresh(() => {
    const value = expressions
      .map(part => part.type === 'text' ? part.value : stringify(part.expression.evaluate(view.scope)))
      .join('');
    if (slot.shouldWrite(value)) {
      node.data = value;
    }
  });
}

export function bindAttributeCompiled(
  app: CompiledBindingHost,
  element: Element,
  target: string,
  parts: CompiledInterpolationPart[]
): Binding {
  const observer = new AttributeObserver(element, target);
  return app.add(new InterpolationBinding(
    app.bindings.length + 1,
    compileInterpolationParts(parts, app),
    value => observer.write(value),
    app.scope
  ));
}

export function bindPropertyCompiled(
  app: CompiledBindingHost,
  element: Element,
  target: string,
  mode: BindingMode,
  source: CompiledExpressionInput,
  forceAttribute = false
): Binding {
  const expression = expressionFrom(source, app);
  const behaviors = createBehaviorInstances(behaviorCalls(source, expression), app.resources);
  const updateEvents = getUpdateEvents(behaviors, app.scope);
  const options = observerOptions(forceAttribute || shouldForceAttribute(behaviors), updateEvents, app.dev);
  return app.add(new PropertyBinding(
    app.bindings.length + 1,
    getBehaviorMode(behaviors) ?? mode,
    expression,
    createTargetObserver(element, target, options),
    app.scope,
    behaviors
  ));
}

export function bindPropertyOptimizedCompiled(
  view: OptimizedCompiledView,
  element: Element,
  target: string,
  mode: BindingMode,
  source: CompiledExpressionInput,
  forceAttribute = false
): void {
  const expression = expressionFrom(source, view);
  const observer = createTargetObserver(element, target, observerOptions(forceAttribute, undefined, view.dev));
  const slot = new ValueSlot<unknown>();

  if (mode === BindingMode.toView || mode === BindingMode.twoWay) {
    view.addRefresh(() => {
      const value = expression.evaluate(view.scope);
      if (slot.shouldWrite(value)) {
        observer.write(value);
      }
    });
  }

  if (mode === BindingMode.fromView || mode === BindingMode.twoWay) {
    view.onDispose(observer.subscribe(() => {
      if (!expression.assign) {
        throw new Error('Cannot assign to expression');
      }

      const currentSourceValue = expression.evaluate(view.scope);
      const sourceValue = observer.readForSource
        ? observer.readForSource(currentSourceValue)
        : observer.read();
      expression.assign(view.scope, sourceValue);
      slot.remember(sourceValue);
    }));
  }
}

export function bindClassCompiled(
  app: CompiledBindingHost,
  element: Element,
  tokens: string[],
  source: CompiledExpressionInput
): Binding {
  const expression = expressionFrom(source, app);
  const behaviors = createBehaviorInstances(behaviorCalls(source, expression), app.resources);
  return app.add(new PropertyBinding(
    app.bindings.length + 1,
    BindingMode.toView,
    expression,
    new TokenClassObserver(element, tokens),
    app.scope,
    behaviors
  ));
}

export function bindClassOptimizedCompiled(
  view: OptimizedCompiledView,
  element: Element,
  tokens: string[],
  source: CompiledExpressionInput
): void {
  const expression = expressionFrom(source, view);
  const slot = new ValueSlot<boolean>();
  view.addRefresh(() => {
    const active = !!expression.evaluate(view.scope);
    if (!slot.shouldWrite(active)) return;

    for (const token of tokens) {
      element.classList.toggle(token, active);
    }
  });
}

export function bindStyleCompiled(
  app: CompiledBindingHost,
  element: Element,
  property: string,
  source: CompiledExpressionInput
): Binding {
  const expression = expressionFrom(source, app);
  const behaviors = createBehaviorInstances(behaviorCalls(source, expression), app.resources);
  return app.add(new PropertyBinding(
    app.bindings.length + 1,
    BindingMode.toView,
    expression,
    new StylePropertyObserver(element, property),
    app.scope,
    behaviors
  ));
}

export function bindShowCompiled(
  app: CompiledBindingHost,
  element: HTMLElement,
  source: CompiledExpressionInput,
  invert = false
): Binding {
  return app.add(new ShowController(
    app.bindings.length + 1,
    element,
    expressionFrom(source, app),
    app.scope,
    invert
  ));
}

export function bindIfCompiled(
  app: CompiledBindingHost,
  anchor: Comment,
  source: string,
  ifFactory: ViewFactory,
  elseFactory: ViewFactory | null = null
): Binding {
  return app.add(new IfController(
    app.bindings.length + 1,
    parseExpression(source, expressionOptions(app)),
    app.scope,
    ifFactory,
    elseFactory,
    anchor
  ));
}

export function bindLetCompiled(
  app: CompiledBindingHost,
  property: string,
  source: CompiledExpressionInput,
  toBindingContext = false
): Binding {
  return app.add(new LetBinding(
    app.bindings.length + 1,
    property,
    expressionFrom(source, app),
    app.scope,
    toBindingContext
  ));
}

export function bindRepeatCompiled(
  app: CompiledBindingHost,
  anchor: Comment,
  source: string,
  factory: ViewFactory,
  metaLocals?: readonly string[]
): Binding {
  const definition = parseRepeat(source);
  return app.add(new RepeatController(
    app.bindings.length + 1,
    definition,
    parseExpression(definition.items, expressionOptions(app)),
    definition.key ? parseExpression(definition.key, expressionOptions(app)) : null,
    app.scope,
    factory,
    anchor,
    metaLocals
  ));
}

export function bindRepeatOptimizedCompiled(
  app: CompiledBindingHost,
  anchor: Comment,
  source: string,
  createRow: OptimizedRepeatRowFactory,
  metaLocals?: readonly string[]
): Binding {
  const definition = parseRepeat(source);
  return app.add(new OptimizedRepeatController(
    app.bindings.length + 1,
    definition,
    parseExpression(definition.items, expressionOptions(app)),
    definition.key ? parseExpression(definition.key, expressionOptions(app)) : null,
    app.scope,
    createRow,
    anchor,
    metaLocals
  ));
}

export function bindWithCompiled(
  app: CompiledBindingHost,
  anchor: Comment,
  source: string,
  factory: ViewFactory
): Binding {
  return app.add(new WithController(
    app.bindings.length + 1,
    parseExpression(source, expressionOptions(app)),
    app.scope,
    factory,
    anchor
  ));
}

export function bindSwitchCompiled(
  app: CompiledBindingHost,
  anchor: Comment,
  source: string,
  caseDefinitions: CompiledSwitchCase[],
  defaultFactory: ViewFactory | null = null
): Binding {
  const cases: SwitchCase[] = caseDefinitions.map(entry => {
    if ('source' in entry) {
      const expression = parseExpression(entry.source, expressionOptions(app));
      return {
        factory: entry.factory,
        matches(value, scope) {
          const caseValue = expression.evaluate(scope);
          return Array.isArray(caseValue)
            ? caseValue.some(item => Object.is(item, value))
            : Object.is(caseValue, value);
        }
      };
    }

    return {
      factory: entry.factory,
      matches(value) {
        return Object.is(String(value), entry.value);
      }
    };
  });
  const defaultCase = defaultFactory
    ? {
        factory: defaultFactory,
        matches: () => false
      }
    : null;

  return app.add(new SwitchController(
    app.bindings.length + 1,
    parseExpression(source, expressionOptions(app)),
    app.scope,
    cases,
    defaultCase,
    anchor
  ));
}

export function bindPromiseCompiled(
  app: CompiledBindingHost,
  anchor: Comment,
  source: string,
  branches: CompiledPromiseBranches
): Binding {
  const controllerBranches: PromiseBranches = {};
  if (branches.pending) controllerBranches.pending = branches.pending;
  if (branches.then) controllerBranches.then = branches.then;
  if (branches.catch) controllerBranches.catch = branches.catch;

  return app.add(new PromiseController(
    app.bindings.length + 1,
    parseExpression(source, expressionOptions(app)),
    app.scope,
    controllerBranches,
    anchor
  ));
}

export function prepareCustomElementCompiled(
  app: CompiledBindingHost,
  element: Element
): boolean {
  return prepareCompiledElement(app, element) !== null;
}

export function bindCustomElementCompiled(
  app: CompiledBindingHost,
  element: Element
): Binding | null {
  const prepared = prepareCompiledElement(app, element);
  if (!prepared || prepared.bound) return prepared?.lifecycle ?? null;

  prepared.bound = true;
  const lifecycle = app.add(new CompiledElementLifecycleBinding(
    app.bindings.length + 1,
    prepared.instance
  ));
  prepared.lifecycle = lifecycle;
  app.add(new CompiledDomViewBinding(
    app.bindings.length + 1,
    prepared.view
  ));
  return lifecycle;
}

export function bindEventCompiled(
  app: CompiledBindingHost,
  element: Element,
  eventName: string,
  capture: boolean,
  modifiers: string[],
  source: CompiledExpressionInput
): Binding {
  const syntax: AttributeSyntax = {
    rawName: eventName,
    rawValue: typeof source === 'string' ? source : source.source,
    target: eventName,
    command: capture ? 'capture' : 'trigger',
    modifiers
  };
  const expression = expressionFrom(source, app);
  const behaviors = createBehaviorInstances(behaviorCalls(source, expression), app.resources);
  return app.add(new EventBinding(
    app.bindings.length + 1,
    element,
    syntax,
    expression,
    app.scope,
    behaviors
  ));
}

export function bindRefCompiled(
  app: CompiledBindingHost,
  property: string,
  value: unknown
): Binding {
  return app.add(new RefBinding(
    app.bindings.length + 1,
    property,
    value,
    app.scope
  ));
}

export function bindSpreadCompiled(
  app: CompiledBindingHost,
  element: Element,
  source: string
): Binding {
  return app.add(new SpreadBinding(
    app.bindings.length + 1,
    element,
    parseExpression(source, expressionOptions(app)),
    app.scope
  ));
}

interface PreparedCompiledElement {
  instance: Record<string, unknown>;
  view: View;
  bound: boolean;
  lifecycle?: Binding;
}

interface RenderedCompiledElementTemplate {
  root: Element | ShadowRoot;
  projected: Node[];
}

const preparedCompiledElements = new WeakMap<Element, PreparedCompiledElement>();
const compiledElementTemplateCache = new WeakMap<ElementDefinition, WeakMap<Document, HTMLTemplateElement>>();
const compiledElementSlotPathCache = new WeakMap<ElementDefinition, WeakMap<Document, CompiledSlotPath[]>>();
const compiledTemplateSlotPathCache = new WeakMap<HTMLTemplateElement, CompiledSlotPath[]>();
const compiledElementBindingPlanCache = new WeakMap<ElementDefinition, WeakMap<Document, WeakMap<ResourceRegistry, CompiledElementBindingPlan | null>>>();
const compiledTemplateBindingPlanCache = new WeakMap<HTMLTemplateElement, WeakMap<ResourceRegistry, CompiledElementBindingPlan | null>>();

interface CompiledSlotPath {
  path: number[];
  name: string;
}

interface CompiledElementBindingPlan {
  instructions: CompiledElementInstruction[];
}

type CompiledElementInstruction =
  | {
      kind: 'text';
      path: number[];
      parts: InterpolationPart[];
    }
  | {
      kind: 'attribute';
      path: number[];
      target: string;
      parts: InterpolationPart[];
    }
  | {
      kind: 'class';
      path: number[];
      attrName: string;
      tokens: string[];
      expression: Expression;
      behaviorCalls: BehaviorCall[];
    }
  | {
      kind: 'style';
      path: number[];
      attrName: string;
      property: string;
      expression: Expression;
      behaviorCalls: BehaviorCall[];
    }
  | {
      kind: 'property';
      path: number[];
      attrName: string;
      target: string;
      command: string | null;
      expression: Expression;
      behaviorCalls: BehaviorCall[];
      forceAttribute: boolean;
    }
  | {
      kind: 'show';
      path: number[];
      attrName: string;
      expression: Expression;
      invert: boolean;
    }
  | {
      kind: 'event';
      path: number[];
      attrName: string;
      syntax: AttributeSyntax;
      expression: Expression;
      behaviorCalls: BehaviorCall[];
    };

function prepareCompiledElement(
  app: CompiledBindingHost,
  element: Element
): PreparedCompiledElement | null {
  const existing = preparedCompiledElements.get(element);
  if (existing) return existing;
  if (!element.parentNode) return null;

  const definition = app.resources.getElement(element.tagName.toLowerCase());
  if (!definition) return null;

  const instance = reactive(new definition.Type() as Record<string, unknown>);
  installCompiledElementAccessors(element, instance, definition.bindables);
  initializeCompiledElementStaticBindables(element, instance, definition.bindables);

  const childScope = app.scope.withContext(instance);
  const lightChildren = childNodes(element);
  const rendered = renderCompiledElementTemplate(element, definition, lightChildren);
  const options = compiledElementViewOptions(app, rendered.projected);
  const view = createFastCompiledElementTemplateView(rendered.root, childScope, app, definition, element.ownerDocument) ??
    new DomView(childNodes(rendered.root), childScope, options);
  const prepared: PreparedCompiledElement = {
    instance,
    view,
    bound: false
  };
  preparedCompiledElements.set(element, prepared);
  if (view instanceof DomView) view.compile();
  return prepared;
}

function installCompiledElementAccessors(
  element: Element,
  instance: Record<string, unknown>,
  bindables: Record<string, BindableDefinition> | undefined
): void {
  if (!bindables) return;

  for (const [name, definition] of Object.entries(bindables)) {
    const property = definition.property ?? kebabToCamel(name);
    defineCompiledElementAccessor(element, property, instance, property, definition);
    if (name !== property) {
      defineCompiledElementAccessor(element, name, instance, property, definition);
    }
  }
}

function defineCompiledElementAccessor(
  element: Element,
  name: string,
  instance: Record<string, unknown>,
  property: string,
  definition: BindableDefinition
): void {
  const current = Object.getOwnPropertyDescriptor(element, name);
  if (current && !current.configurable) return;

  try {
    Object.defineProperty(element, name, {
      configurable: true,
      get() {
        return instance[property];
      },
      set(value: unknown) {
        writeCompiledBindable(instance, property, definition, value);
      }
    });
  } catch {
    // Some host properties may be locked down by the DOM implementation.
  }
}

function initializeCompiledElementStaticBindables(
  element: Element,
  instance: Record<string, unknown>,
  bindables: Record<string, BindableDefinition> | undefined
): void {
  if (!bindables) return;

  for (const attr of Array.from(element.attributes)) {
    const syntax = parseAttributeSyntax(attr.name, attr.value);
    const bindable = findCompiledBindable(bindables, syntax.target);
    if (!bindable.definition) continue;

    writeCompiledBindable(instance, bindable.property, bindable.definition, attr.value);
    element.removeAttribute(attr.name);
  }
}

function writeCompiledBindable(
  instance: Record<string, unknown>,
  property: string,
  definition: BindableDefinition,
  value: unknown
): void {
  instance[property] = definition.set ? definition.set(value) : value;
}

function findCompiledBindable(
  bindables: Record<string, BindableDefinition>,
  requested: string
): { property: string; definition?: BindableDefinition } {
  const camel = kebabToCamel(requested);
  const definition = bindables[requested] ?? bindables[camel];
  return {
    property: definition?.property ?? camel,
    ...(definition ? { definition } : {})
  };
}

function renderCompiledElementTemplate(
  element: Element,
  definition: ElementDefinition,
  lightChildren: Node[]
): RenderedCompiledElementTemplate {
  const root = definition.shadow === 'open'
    ? element.shadowRoot ?? element.attachShadow({ mode: 'open' })
    : element;

  while (root.firstChild) {
    root.removeChild(root.firstChild);
  }

  const fragment = cloneCompiledElementTemplate(definition, element.ownerDocument);
  const projected = definition.shadow === 'open'
    ? []
    : projectCompiledSlots(fragment, lightChildren, compiledElementSlotPaths(definition, element.ownerDocument));
  root.append(fragment);
  return { root, projected };
}

function projectCompiledSlots(fragment: DocumentFragment, lightChildren: Node[], slotPaths: CompiledSlotPath[]): Node[] {
  const slots = slotPaths
    .map(({ path, name }) => ({ slot: compiledNodeAtPath(fragment, path), name }))
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

function compiledElementSlotPaths(definition: ElementDefinition, ownerDocument: Document): CompiledSlotPath[] {
  if (typeof definition.template !== 'string') {
    let paths = compiledTemplateSlotPathCache.get(definition.template);
    if (!paths) {
      paths = collectCompiledSlotPaths(definition.template.content);
      compiledTemplateSlotPathCache.set(definition.template, paths);
    }
    return paths;
  }

  let documents = compiledElementSlotPathCache.get(definition);
  if (!documents) {
    documents = new WeakMap();
    compiledElementSlotPathCache.set(definition, documents);
  }

  let paths = documents.get(ownerDocument);
  if (!paths) {
    paths = collectCompiledSlotPaths(compiledElementTemplate(definition, ownerDocument).content);
    documents.set(ownerDocument, paths);
  }
  return paths;
}

function collectCompiledSlotPaths(
  parent: ParentNode,
  parentPath: number[] = [],
  paths: CompiledSlotPath[] = []
): CompiledSlotPath[] {
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
    collectCompiledSlotPaths(node, path, paths);
  }
  return paths;
}

function compiledNodeAtPath(root: Node, path: number[]): Node | null {
  let current: Node | null = root;
  for (const index of path) {
    current = current?.childNodes[index] ?? null;
    if (!current) return null;
  }
  return current;
}

function cloneCompiledElementTemplate(
  definition: ElementDefinition,
  ownerDocument: Document
): DocumentFragment {
  if (typeof definition.template !== 'string') {
    return definition.template.content.cloneNode(true) as DocumentFragment;
  }

  return compiledElementTemplate(definition, ownerDocument).content.cloneNode(true) as DocumentFragment;
}

function compiledElementTemplate(
  definition: ElementDefinition,
  ownerDocument: Document
): HTMLTemplateElement {
  if (typeof definition.template !== 'string') {
    return definition.template;
  }

  let documents = compiledElementTemplateCache.get(definition);
  if (!documents) {
    documents = new WeakMap();
    compiledElementTemplateCache.set(definition, documents);
  }

  let template = documents.get(ownerDocument);
  if (!template) {
    template = ownerDocument.createElement('template');
    template.innerHTML = definition.template;
    documents.set(ownerDocument, template);
  }

  return template;
}

function compiledElementViewOptions(
  app: CompiledBindingHost,
  projected: Node[]
): RuntimeCompileOptions {
  const options: RuntimeCompileOptions = { resources: app.resources };
  if (app.dev !== undefined) options.dev = app.dev;
  if (app.onError !== undefined) options.onError = app.onError;
  if (app.onWarn !== undefined) options.onWarn = app.onWarn;
  if (projected.length > 0) options.projectedScopes = skippedProjectedScopeMap(projected);
  return options;
}

function skippedProjectedScopeMap(nodes: Node[]): WeakMap<Node, Scope | null> {
  const scopes = new WeakMap<Node, Scope | null>();
  for (const node of nodes) scopes.set(node, null);
  return scopes;
}

function createFastCompiledElementTemplateView(
  root: Element | ShadowRoot,
  scope: Scope,
  app: CompiledBindingHost,
  definition: ElementDefinition,
  ownerDocument: Document
): View | null {
  const plan = compiledElementBindingPlan(definition, ownerDocument, app);
  if (!plan) return null;
  return new FastCompiledElementTemplateView(childNodes(root), root, scope, app, plan);
}

function compiledElementBindingPlan(
  definition: ElementDefinition,
  ownerDocument: Document,
  app: CompiledBindingHost
): CompiledElementBindingPlan | null {
  if (typeof definition.template !== 'string') {
    let resources = compiledTemplateBindingPlanCache.get(definition.template);
    if (!resources) {
      resources = new WeakMap();
      compiledTemplateBindingPlanCache.set(definition.template, resources);
    }

    if (resources.has(app.resources)) return resources.get(app.resources) ?? null;
    const plan = buildCompiledElementBindingPlan(definition.template.content, app);
    resources.set(app.resources, plan);
    return plan;
  }

  let documents = compiledElementBindingPlanCache.get(definition);
  if (!documents) {
    documents = new WeakMap();
    compiledElementBindingPlanCache.set(definition, documents);
  }

  let resources = documents.get(ownerDocument);
  if (!resources) {
    resources = new WeakMap();
    documents.set(ownerDocument, resources);
  }

  if (resources.has(app.resources)) return resources.get(app.resources) ?? null;
  const plan = buildCompiledElementBindingPlan(compiledElementTemplate(definition, ownerDocument).content, app);
  resources.set(app.resources, plan);
  return plan;
}

function buildCompiledElementBindingPlan(
  root: DocumentFragment,
  app: CompiledBindingHost
): CompiledElementBindingPlan | null {
  const instructions: CompiledElementInstruction[] = [];
  const slotPaths = collectCompiledSlotPaths(root);
  if (!collectCompiledElementInstructions(root, [], app, instructions)) return null;
  if (hasSlotSensitiveInstruction(instructions, slotPaths)) return null;
  return { instructions };
}

function collectCompiledElementInstructions(
  parent: ParentNode,
  parentPath: number[],
  app: CompiledBindingHost,
  instructions: CompiledElementInstruction[]
): boolean {
  const nodes = Array.from(parent.childNodes);
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    const path = [...parentPath, index];

    if (node instanceof Text) {
      if (hasInterpolation(node.data)) {
        const parts = parseInterpolation(node.data, expressionOptions(app));
        if (app.dev && interpolationHasAssignment(parts)) return false;
        instructions.push({
          kind: 'text',
          path,
          parts
        });
      }
      continue;
    }

    if (!(node instanceof Element)) continue;
    if (node.tagName.toLowerCase() === 'slot') {
      if (node.childNodes.length > 0) return false;
      continue;
    }
    if (node.tagName.includes('-')) return false;

    for (const attr of Array.from(node.attributes)) {
      const syntax = parseAttributeSyntax(attr.name, attr.value);
      if (syntax.rawName.startsWith('...') || syntax.rawName === 'ref' || syntax.command === 'ref') return false;
      if (isCompiledTemplateControllerAttr(attr.name)) return false;
      if (syntax.command === null) {
        if (app.resources.getAttribute(syntax.target)) return false;
        if (hasInterpolation(attr.value)) {
          const parts = parseInterpolation(attr.value, expressionOptions(app));
          if (app.dev && interpolationHasAssignment(parts)) return false;
          instructions.push({
            kind: 'attribute',
            path,
            target: attr.name,
            parts
          });
        }
        continue;
      }

      if (syntax.command === 'trigger' || syntax.command === 'capture') {
        const expression = parseExpression(attr.value, expressionOptions(app));
        instructions.push({
          kind: 'event',
          path,
          attrName: attr.name,
          syntax,
          expression,
          behaviorCalls: collectBehaviorCalls(expression.ast)
        });
        continue;
      }

      if (hasInterpolation(attr.value)) return false;
      const expression = parseExpression(attr.value, expressionOptions(app));
      if (app.dev && hasAssignment(expression.ast)) return false;

      if (syntax.command === 'class') {
        instructions.push({
          kind: 'class',
          path,
          attrName: attr.name,
          tokens: syntax.target.split(',').filter(Boolean),
          expression,
          behaviorCalls: collectBehaviorCalls(expression.ast)
        });
        continue;
      }

      if (syntax.command === 'style') {
        instructions.push({
          kind: 'style',
          path,
          attrName: attr.name,
          property: syntax.target,
          expression,
          behaviorCalls: collectBehaviorCalls(expression.ast)
        });
        continue;
      }

      if (syntax.command === 'bind' && (syntax.target === 'show' || syntax.target === 'hide')) {
        instructions.push({
          kind: 'show',
          path,
          attrName: attr.name,
          expression,
          invert: syntax.target === 'hide'
        });
        continue;
      }

      if (isCompiledBindingCommand(syntax.command)) {
        if (syntax.target.startsWith('style.')) {
          instructions.push({
            kind: 'style',
            path,
            attrName: attr.name,
            property: syntax.target.slice('style.'.length),
            expression,
            behaviorCalls: collectBehaviorCalls(expression.ast)
          });
          continue;
        }

        instructions.push({
          kind: 'property',
          path,
          attrName: attr.name,
          target: syntax.target,
          command: syntax.command,
          expression,
          behaviorCalls: collectBehaviorCalls(expression.ast),
          forceAttribute: syntax.command === 'attr'
        });
        continue;
      }

      return false;
    }

    if (!collectCompiledElementInstructions(node, path, app, instructions)) return false;
  }

  return true;
}

function hasSlotSensitiveInstruction(
  instructions: CompiledElementInstruction[],
  slotPaths: CompiledSlotPath[]
): boolean {
  for (const instruction of instructions) {
    for (const slot of slotPaths) {
      if (isPathPrefix(slot.path, instruction.path)) return true;
      if (sameParentPath(slot.path, instruction.path) && slot.path.at(-1)! < instruction.path.at(-1)!) {
        return true;
      }
    }
  }
  return false;
}

function isPathPrefix(prefix: number[], path: number[]): boolean {
  return prefix.length < path.length && prefix.every((part, index) => path[index] === part);
}

function sameParentPath(left: number[], right: number[]): boolean {
  if (left.length !== right.length || left.length === 0) return false;
  for (let index = 0; index < left.length - 1; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function isCompiledTemplateControllerAttr(name: string): boolean {
  return name === 'if.bind' ||
    name === 'repeat.for' ||
    name === 'with.bind' ||
    name === 'switch.bind' ||
    name === 'promise.bind' ||
    name === 'else' ||
    name === 'case' ||
    name === 'case.bind' ||
    name === 'default-case' ||
    name === 'pending' ||
    name === 'then' ||
    name === 'catch';
}

function isCompiledBindingCommand(command: string | null): boolean {
  return command === 'bind' ||
    command === 'to-view' ||
    command === 'one-way' ||
    command === 'two-way' ||
    command === 'from-view' ||
    command === 'one-time' ||
    command === 'attr';
}

function interpolationHasAssignment(parts: InterpolationPart[]): boolean {
  return parts.some(part => part.type === 'expression' && hasAssignment(part.expression.ast));
}

function createCompiledElementObserver(
  element: Element,
  rawTarget: string,
  options: TargetObserverOptions
) {
  if (rawTarget.startsWith('style.')) {
    return new StylePropertyObserver(element, rawTarget.slice('style.'.length));
  }
  return createTargetObserver(element, normalizeCompiledElementBindingTarget(rawTarget), options);
}

function normalizeCompiledElementBindingTarget(target: string): string {
  if (target === 'text') return 'textContent';
  if (target === 'value-as-number') return 'valueAsNumber';
  if (target === 'value-as-date') return 'valueAsDate';
  return target;
}

function compileInterpolationParts(parts: CompiledInterpolationPart[], app: CompiledBindingHost): InterpolationPart[] {
  return parts.map(part => part.type === 'text'
    ? part
    : {
        type: 'expression',
        expression: expressionFrom(part.source, app)
      });
}

function expressionFrom(source: CompiledExpressionInput, app: CompiledBindingHost): Expression {
  if (typeof source === 'string') return parseExpression(source, expressionOptions(app));

  const expression: Expression = {
    source: source.source,
    ast: emptyAst,
    evaluate: scope => source.evaluate(scope)
  };
  if (source.assign) {
    return {
      ...expression,
      assign: (scope, value) => source.assign!(scope, value)
    };
  }
  return expression;
}

function behaviorCalls(source: CompiledExpressionInput, expression: Expression) {
  return typeof source === 'string'
    ? collectBehaviorCalls(expression.ast)
    : [];
}

function expressionOptions(app: CompiledBindingHost): ExpressionOptions {
  return app.dev === undefined
    ? {
        resources: app.resources,
        ...(app.onError === undefined ? {} : { onError: app.onError }),
        ...(app.onWarn === undefined ? {} : { onWarn: app.onWarn })
      }
    : {
        resources: app.resources,
        dev: app.dev,
        ...(app.onError === undefined ? {} : { onError: app.onError }),
        ...(app.onWarn === undefined ? {} : { onWarn: app.onWarn })
      };
}

function observerOptions(
  forceAttribute: boolean,
  updateEvents: string[] | undefined,
  dev: boolean | undefined
): TargetObserverOptions {
  const options: TargetObserverOptions = { forceAttribute };
  if (updateEvents) options.updateEvents = updateEvents;
  if (dev !== undefined) options.dev = dev;
  return options;
}

const emptyAst: ExpressionNode = { type: 'Literal', value: undefined };
type CompiledExpressionEvaluator = (scope: Scope) => unknown;
const compiledExpressionEvaluatorCache = new WeakMap<Expression, CompiledExpressionEvaluator | null>();

function stringify(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function evaluateCompiledExpression(expression: Expression, scope: Scope): unknown {
  let evaluator: CompiledExpressionEvaluator | null;
  if (compiledExpressionEvaluatorCache.has(expression)) {
    evaluator = compiledExpressionEvaluatorCache.get(expression) ?? null;
  } else {
    evaluator = createCompiledExpressionEvaluator(expression.ast);
    compiledExpressionEvaluatorCache.set(expression, evaluator);
  }

  return evaluator ? evaluator(scope) : expression.evaluate(scope);
}

function createCompiledExpressionEvaluator(node: ExpressionNode): CompiledExpressionEvaluator | null {
  switch (node.type) {
    case 'Literal':
      return () => node.value;

    case 'Identifier':
      return scope => getIdentifier(scope, node.name);

    case 'AccessMember': {
      const object = createCompiledExpressionEvaluator(node.object);
      if (!object) return null;
      return scope => {
        const value = object(scope);
        if (value == null) {
          if (node.optional) return undefined;
          throw new LamiError('E_EXPR_PARSE', `Cannot read ${node.name} from nullish value`);
        }
        return (value as Record<string, unknown>)[node.name];
      };
    }

    case 'AccessKeyed': {
      const object = createCompiledExpressionEvaluator(node.object);
      const key = createCompiledExpressionEvaluator(node.key);
      if (!object || !key) return null;
      return scope => {
        const value = object(scope);
        if (value == null) {
          if (node.optional) return undefined;
          throw new LamiError('E_EXPR_PARSE', 'Cannot read keyed property from nullish value');
        }
        return (value as Record<PropertyKey, unknown>)[key(scope) as PropertyKey];
      };
    }

    case 'Unary': {
      const expression = createCompiledExpressionEvaluator(node.expression);
      if (!expression) return null;
      switch (node.operator) {
        case '!': return scope => !expression(scope);
        case '-': return scope => -(expression(scope) as number);
        case '+': return scope => +(expression(scope) as number);
        case 'typeof': return scope => typeof expression(scope);
      }
    }

    case 'Binary': {
      const left = createCompiledExpressionEvaluator(node.left);
      const right = createCompiledExpressionEvaluator(node.right);
      if (!left || !right) return null;
      return scope => evaluateCompiledBinary(node.operator, left, right, scope);
    }

    case 'Conditional': {
      const test = createCompiledExpressionEvaluator(node.test);
      const consequent = createCompiledExpressionEvaluator(node.consequent);
      const alternate = createCompiledExpressionEvaluator(node.alternate);
      if (!test || !consequent || !alternate) return null;
      return scope => test(scope) ? consequent(scope) : alternate(scope);
    }

    case 'CallFunction': {
      const args = compiledArgumentEvaluators(node.args);
      if (!args) return null;
      if (node.callee.type === 'Identifier') {
        const name = node.callee.name;
        return scope => callCompiledFunction(
          getIdentifier(scope, name),
          scope.bindingContext,
          args,
          scope,
          node.optional
        );
      }
      if (node.callee.type === 'AccessMember') {
        const object = createCompiledExpressionEvaluator(node.callee.object);
        const name = node.callee.name;
        if (!object) return null;
        return scope => {
          const value = object(scope);
          if (value == null) return node.optional ? undefined : callCompiledFunction(undefined, undefined, args, scope, false);
          return callCompiledFunction(
            (value as Record<string, unknown>)[name],
            value,
            args,
            scope,
            node.optional
          );
        };
      }
      return null;
    }

    case 'CallMember': {
      const object = createCompiledExpressionEvaluator(node.object);
      const args = compiledArgumentEvaluators(node.args);
      if (!object || !args) return null;
      return scope => {
        const value = object(scope);
        if (value == null) {
          if (node.optional) return undefined;
          throw new LamiError('E_EXPR_PARSE', `Cannot call ${node.name} on nullish value`);
        }
        return callCompiledFunction(
          (value as Record<string, unknown>)[node.name],
          value,
          args,
          scope,
          node.optional
        );
      };
    }

    default:
      return null;
  }
}

function compiledArgumentEvaluators(nodes: ExpressionNode[]): CompiledExpressionEvaluator[] | null {
  const evaluators: CompiledExpressionEvaluator[] = [];
  for (const node of nodes) {
    const evaluator = createCompiledExpressionEvaluator(node);
    if (!evaluator) return null;
    evaluators.push(evaluator);
  }
  return evaluators;
}

function callCompiledFunction(
  fn: unknown,
  thisArg: unknown,
  args: CompiledExpressionEvaluator[],
  scope: Scope,
  optional = false
): unknown {
  if (fn == null && optional) return undefined;
  if (typeof fn !== 'function') {
    throw new LamiError('E_EXPR_PARSE', 'Expression is not callable');
  }
  return fn.apply(thisArg, args.map(arg => arg(scope)));
}

function evaluateCompiledBinary(
  operator: string,
  left: CompiledExpressionEvaluator,
  right: CompiledExpressionEvaluator,
  scope: Scope
): unknown {
  switch (operator) {
    case '&&': {
      const leftValue = left(scope);
      return leftValue ? right(scope) : leftValue;
    }
    case '||': {
      const leftValue = left(scope);
      return leftValue ? leftValue : right(scope);
    }
    case '??': {
      const leftValue = left(scope);
      return leftValue ?? right(scope);
    }
  }

  const leftValue = left(scope);
  const rightValue = right(scope);
  switch (operator) {
    case '==': return leftValue == rightValue;
    case '!=': return leftValue != rightValue;
    case '===': return leftValue === rightValue;
    case '!==': return leftValue !== rightValue;
    case '<': return (leftValue as number) < (rightValue as number);
    case '>': return (leftValue as number) > (rightValue as number);
    case '<=': return (leftValue as number) <= (rightValue as number);
    case '>=': return (leftValue as number) >= (rightValue as number);
    case 'in': return (leftValue as PropertyKey) in (rightValue as object);
    case '+': return (leftValue as number) + (rightValue as number);
    case '-': return (leftValue as number) - (rightValue as number);
    case '*': return (leftValue as number) * (rightValue as number);
    case '/': return (leftValue as number) / (rightValue as number);
    case '%': return (leftValue as number) % (rightValue as number);
    default:
      throw new LamiError('E_EXPR_PARSE', `Unsupported operator ${operator}`);
  }
}

function evaluateInterpolation(parts: InterpolationPart[], scope: Scope): string {
  let value = '';
  for (const part of parts) {
    value += part.type === 'text'
      ? part.value
      : stringify(evaluateCompiledExpression(part.expression, scope));
  }
  return value;
}

function writeCompiledStyleProperty(style: CSSStyleDeclaration, key: string, value: unknown): void {
  if (value === null || value === undefined || value === false) {
    if (key.includes('-')) style.removeProperty(key);
    else (style as unknown as Record<string, string>)[key] = '';
    return;
  }

  if (key.includes('-')) {
    style.setProperty(key, String(value));
  } else {
    (style as unknown as Record<string, string>)[key] = String(value);
  }
}

function createCompiledElementRefreshWriter(
  element: Element,
  rawTarget: string,
  forceAttribute: boolean,
  dev: boolean | undefined
): (value: unknown) => void {
  const target = normalizeCompiledElementBindingTarget(rawTarget);
  if (forceAttribute) {
    return value => writeAttribute(element, target, value);
  }

  if (canDirectWriteCompiledElementProperty(element, target)) {
    return value => writeProperty(element, target, value);
  }

  const observer = createCompiledElementObserver(element, rawTarget, observerOptions(false, undefined, dev));
  return value => observer.write(value);
}

function canDirectWriteCompiledElementProperty(element: Element, target: string): boolean {
  return target !== 'class' &&
    target !== 'style' &&
    target !== 'model' &&
    target !== 'focus' &&
    element.namespaceURI !== 'http://www.w3.org/2000/svg';
}

class OptimizedRepeatController extends BindingController {
  private rows: OptimizedCompiledRepeatRow[] = [];
  private keyedRows = new Map<unknown, OptimizedCompiledRepeatRow>();
  private readonly simplePatternName: string | null;
  private readonly simpleKeyName: string | null;
  private readonly usesIndex: boolean;
  private readonly usesFirst: boolean;
  private readonly usesLast: boolean;
  private readonly usesMiddle: boolean;
  private readonly usesEven: boolean;
  private readonly usesOdd: boolean;
  private readonly usesLength: boolean;
  private readonly needsPrevious: boolean;

  constructor(
    id: number,
    private readonly definition: RepeatDefinition,
    private readonly itemsExpression: Expression,
    private readonly keyExpression: Expression | null,
    private readonly scope: Scope,
    private readonly createRow: OptimizedRepeatRowFactory,
    private readonly location: Comment,
    metaLocals: readonly string[] = defaultRepeatMetaLocals
  ) {
    super(id, BindingMode.toView);
    this.simplePatternName = simpleIdentifier(definition.pattern);
    this.simpleKeyName = keyExpression ? simpleIdentifier(keyExpression.source.trim()) : null;
    const meta = new Set(metaLocals);
    this.usesIndex = meta.has('$index');
    this.usesFirst = meta.has('$first');
    this.usesLast = meta.has('$last');
    this.usesMiddle = meta.has('$middle');
    this.usesEven = meta.has('$even');
    this.usesOdd = meta.has('$odd');
    this.usesLength = meta.has('$length');
    this.needsPrevious = meta.has('$previous');
  }

  bind(): void {
    this.runEffect(() => this.refresh());
  }

  refresh(): void {
    const items = materialize(this.itemsExpression.evaluate(this.scope));
    if (this.keyExpression) {
      this.refreshKeyed(items);
    } else {
      this.refreshIndexed(items);
    }
  }

  override unbind(): void {
    if (rootDisposeDepth > 0) {
      for (const row of this.rows) {
        row.dispose(false);
      }
      this.rows = [];
      this.keyedRows.clear();
      super.unbind();
      return;
    }

    const parent = this.location.parentNode;
    const canReplaceChildren = this.rows.length > 0 &&
      parent !== null &&
      parent.firstChild === this.rows[0]!.first &&
      parent.lastChild === this.location;

    for (const row of this.rows) {
      row.dispose(!canReplaceChildren);
    }
    if (canReplaceChildren) {
      parent.replaceChildren(this.location);
    }
    this.rows = [];
    this.keyedRows.clear();
    super.unbind();
  }

  private refreshIndexed(items: unknown[]): void {
    let pendingFragment: DocumentFragment | undefined;
    const pendingRows: OptimizedCompiledRepeatRow[] = [];
    const flushPending = () => {
      if (!pendingFragment) return;
      this.location.parentNode?.insertBefore(pendingFragment, this.location);
      pendingFragment = undefined;
      for (const row of pendingRows) row.bind();
      pendingRows.length = 0;
    };

    for (let index = 0; index < items.length; index++) {
      const item = this.toRepeatItem(items[index]);
      const previous = this.needsPrevious ? this.toRepeatItem(items[index - 1]) : undefined;
      let row = this.rows[index];
      if (!row) {
        row = this.createRow() as OptimizedCompiledRepeatRow;
        this.rows[index] = row;
        this.updateRow(row, item, index, items.length, previous);
        pendingFragment ??= this.location.ownerDocument.createDocumentFragment();
        row.appendTo(pendingFragment);
        pendingRows.push(row);
        continue;
      }
      flushPending();
      this.updateRow(row, item, index, items.length, previous);
    }
    flushPending();

    while (this.rows.length > items.length) {
      const row = this.rows.pop()!;
      row.dispose();
    }
  }

  private refreshKeyed(items: unknown[]): void {
    if (this.rows.length === 0) {
      this.mountInitialKeyed(items);
      return;
    }

    const nextKeys = this.collectKeyedKeys(items);
    this.disposeMissingKeyedRows(nextKeys);

    const nextRows: OptimizedCompiledRepeatRow[] = [];
    const nextKeyed = new Map<unknown, OptimizedCompiledRepeatRow>();
    let reference: Node = this.firstConnectedRowNode() ?? this.location;
    let pendingFragment: DocumentFragment | undefined;
    let pendingReference: Node | undefined;
    const pendingRows: OptimizedCompiledRepeatRow[] = [];
    const flushPending = () => {
      if (!pendingFragment || !pendingReference) return;
      pendingReference.parentNode?.insertBefore(pendingFragment, pendingReference);
      pendingFragment = undefined;
      pendingReference = undefined;
      for (const row of pendingRows) row.bind();
      pendingRows.length = 0;
    };

    for (let index = 0; index < items.length; index++) {
      const sourceItem = items[index];
      const item = this.toRepeatItem(sourceItem);
      const previous = this.needsPrevious ? this.toRepeatItem(items[index - 1]) : undefined;
      let key = this.simpleKey(sourceItem);
      if (key === noSimpleKey) {
        key = this.evaluateKey(item, sourceItem);
      }
      if (nextKeyed.has(key)) {
        throw new Error(`Duplicate repeat key "${String(key)}"`);
      }

      let row = this.keyedRows.get(key);
      const isNew = !row;
      if (!row) {
        row = this.createRow() as OptimizedCompiledRepeatRow;
      }

      this.updateRow(row, item, index, items.length, previous);
      if (isNew) {
        pendingFragment ??= this.location.ownerDocument.createDocumentFragment();
        pendingReference ??= reference;
        row.appendTo(pendingFragment);
        pendingRows.push(row);
      } else {
        flushPending();
        if (row.first !== reference) {
          row.moveBefore(reference);
        }
        reference = row.last.nextSibling ?? this.location;
      }
      nextRows.push(row);
      nextKeyed.set(key, row);
    }
    flushPending();

    this.rows = nextRows;
    this.keyedRows = nextKeyed;
  }

  private collectKeyedKeys(items: unknown[]): Set<unknown> {
    const keys = new Set<unknown>();
    for (let index = 0; index < items.length; index++) {
      const sourceItem = items[index];
      let key = this.simpleKey(sourceItem);
      if (key === noSimpleKey) {
        key = this.evaluateKey(this.toRepeatItem(sourceItem), sourceItem);
      }
      if (keys.has(key)) {
        throw new Error(`Duplicate repeat key "${String(key)}"`);
      }
      keys.add(key);
    }
    return keys;
  }

  private disposeMissingKeyedRows(nextKeys: ReadonlySet<unknown>): void {
    for (const [key, row] of this.keyedRows) {
      if (nextKeys.has(key)) continue;
      row.dispose();
      this.keyedRows.delete(key);
    }
  }

  private firstConnectedRowNode(): Node | undefined {
    for (const row of this.rows) {
      if (row.first.parentNode) return row.first;
    }
    return undefined;
  }

  private mountInitialKeyed(items: unknown[]): void {
    const rows: OptimizedCompiledRepeatRow[] = [];
    const keyedRows = new Map<unknown, OptimizedCompiledRepeatRow>();
    const fragment = this.location.ownerDocument.createDocumentFragment();

    for (let index = 0; index < items.length; index++) {
      const sourceItem = items[index];
      const item = this.toRepeatItem(sourceItem);
      const previous = this.needsPrevious ? this.toRepeatItem(items[index - 1]) : undefined;
      let key = this.simpleKey(sourceItem);
      if (key === noSimpleKey) {
        key = this.evaluateKey(item, sourceItem);
      }
      if (keyedRows.has(key)) {
        throw new Error(`Duplicate repeat key "${String(key)}"`);
      }

      const row = this.createRow() as OptimizedCompiledRepeatRow;
      this.updateRow(row, item, index, items.length, previous);
      row.appendTo(fragment);
      rows.push(row);
      keyedRows.set(key, row);
    }

    if (rows.length > 0) {
      this.location.parentNode?.insertBefore(fragment, this.location);
      for (const row of rows) row.bind();
    }

    this.rows = rows;
    this.keyedRows = keyedRows;
  }

  private updateRow(
    row: OptimizedCompiledRepeatRow,
    item: unknown,
    index: number,
    length: number,
    previous: unknown
  ): void {
    const locals = row.scope.locals;
    if (this.simplePatternName) {
      locals[this.simplePatternName] = item;
    }
    if (this.usesIndex) locals.$index = index;
    if (this.usesFirst) locals.$first = index === 0;
    if (this.usesLast) locals.$last = index === length - 1;
    if (this.usesMiddle) locals.$middle = index > 0 && index < length - 1;
    if (this.usesEven) locals.$even = index % 2 === 0;
    if (this.usesOdd) locals.$odd = index % 2 === 1;
    if (this.usesLength) locals.$length = length;
    if (this.needsPrevious) locals.$previous = previous;
    row.runRefresh();
  }

  private evaluateKey(item: unknown, sourceItem = item): unknown {
    const simple = this.simpleKey(sourceItem);
    if (simple !== noSimpleKey) {
      return simple;
    }

    const scope = this.scope.withLocals(markRaw(Object.create(null)));
    if (this.simplePatternName) {
      scope.locals[this.simplePatternName] = item;
    }
    return this.keyExpression!.evaluate(scope);
  }

  private simpleKey(item: unknown): unknown {
    if (
      this.simpleKeyName &&
      item !== null &&
      typeof item === 'object' &&
      Object.prototype.hasOwnProperty.call(item, this.simpleKeyName)
    ) {
      return (item as Record<string, unknown>)[this.simpleKeyName];
    }
    return noSimpleKey;
  }

  private toRepeatItem(item: unknown): unknown {
    return item !== null && typeof item === 'object'
      ? reactive(item)
      : item;
  }
}

class OptimizedCompiledRepeatRow implements OptimizedRepeatRow {
  readonly first: Node;
  readonly last: Node;
  private refresh: (() => void) | undefined;
  private bound = false;
  private binders: RowBinder | RowBinder[] | undefined;
  private cleanups: Cleanup | Cleanup[] | undefined;

  constructor(
    private readonly nodes: Node[],
    public readonly scope: Scope
  ) {
    this.first = nodes[0] ?? document.createComment('empty');
    this.last = nodes[nodes.length - 1] ?? this.first;
  }

  setRefresh(refresh: () => void): void {
    this.refresh = refresh;
  }

  onBind(callback: () => Cleanup | void): void {
    if (!this.binders) {
      this.binders = callback;
    } else if (Array.isArray(this.binders)) {
      this.binders.push(callback);
    } else {
      this.binders = [this.binders, callback];
    }
  }

  onDispose(cleanup: Cleanup): void {
    if (!this.cleanups) {
      this.cleanups = cleanup;
    } else if (Array.isArray(this.cleanups)) {
      this.cleanups.push(cleanup);
    } else {
      this.cleanups = [this.cleanups, cleanup];
    }
  }

  bind(): void {
    if (this.bound) return;
    this.bound = true;
    if (Array.isArray(this.binders)) {
      for (const binder of this.binders) {
        const cleanup = binder();
        if (cleanup) this.onDispose(cleanup);
      }
      return;
    }

    if (this.binders) {
      const cleanup = this.binders();
      if (cleanup) this.onDispose(cleanup);
    }
  }

  runRefresh(): void {
    this.refresh?.();
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

  dispose(removeNodes = true): void {
    if (Array.isArray(this.cleanups)) {
      for (let index = this.cleanups.length - 1; index >= 0; index--) {
        this.cleanups[index]!();
      }
    } else if (this.cleanups) {
      this.cleanups();
    }
    this.cleanups = undefined;
    this.bound = false;
    if (removeNodes) removeAll(this.nodes);
  }
}

type RowBinder = () => Cleanup | void;

function simpleIdentifier(source: string): string | null {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(source) ? source : null;
}

const defaultRepeatMetaLocals = ['$index', '$first', '$last', '$middle', '$even', '$odd', '$length', '$previous'];
const noSimpleKey = Symbol('lami.noSimpleKey');

function clearRootChildren(root: Element | DocumentFragment): void {
  if (root instanceof Element) {
    root.textContent = '';
    return;
  }
  removeAll(childNodes(root));
}

function createOptimizedRepeatScope(parent: Scope): Scope {
  const scope = {
    bindingContext: parent.bindingContext,
    parent,
    locals: markRaw(Object.create(null)),
    withContext(bindingContext: object) {
      return new Scope(bindingContext, scope);
    },
    withLocals(locals: Record<string, unknown>) {
      return new Scope(parent.bindingContext, scope, locals);
    },
    withLocal(name: string, value: unknown) {
      return new Scope(parent.bindingContext, scope, { [name]: value });
    }
  };
  return scope as Scope;
}

class CompiledTemplateView implements CompiledView {
  readonly bindings: Binding[] = [];
  readonly first: Node;
  readonly last: Node;
  readonly dev?: boolean;
  readonly onError?: (error: LamiError) => void;
  readonly onWarn?: (warning: LamiWarning) => void;
  private bound = false;
  private refreshEffect: EffectHandle | undefined;
  private readonly refreshers: Array<() => void> = [];
  private readonly cleanups: Cleanup[] = [];

  constructor(
    private readonly nodes: Node[],
    public readonly scope: Scope,
    public readonly resources: ResourceRegistry,
    diagnostics: Pick<CompiledBindingHost, 'dev' | 'onError' | 'onWarn'>
  ) {
    this.first = nodes[0] ?? document.createComment('empty');
    this.last = nodes[nodes.length - 1] ?? this.first;
    if (diagnostics.dev !== undefined) this.dev = diagnostics.dev;
    if (diagnostics.onError !== undefined) this.onError = diagnostics.onError;
    if (diagnostics.onWarn !== undefined) this.onWarn = diagnostics.onWarn;
  }

  add(binding: Binding): Binding {
    if (binding instanceof BindingController) {
      binding.setDiagnostics(this);
    }
    this.bindings.push(binding);
    return binding;
  }

  addRefresh(refresh: () => void): void {
    this.refreshers.push(refresh);
  }

  onDispose(cleanup: Cleanup): void {
    this.cleanups.push(cleanup);
  }

  bind(): void {
    if (this.bound) return;
    this.bound = true;
    if (this.refreshers.length > 0) {
      this.refreshEffect = effect(() => this.refresh());
    }
    for (const binding of this.bindings) {
      runBindingLifecycle(this, binding, 'bind', () => binding.bind());
    }
  }

  refresh(): void {
    for (const refresh of this.refreshers) {
      refresh();
    }
    for (const binding of this.bindings) {
      runBindingLifecycle(this, binding, 'refresh', () => binding.refresh());
    }
  }

  unbind(): void {
    if (!this.bound) return;
    this.refreshEffect?.stop();
    this.refreshEffect = undefined;
    for (let index = this.cleanups.length - 1; index >= 0; index--) {
      this.cleanups[index]!();
    }
    this.cleanups.length = 0;
    for (let index = this.bindings.length - 1; index >= 0; index--) {
      const binding = this.bindings[index]!;
      runBindingLifecycle(this, binding, 'unbind', () => binding.unbind());
    }
    this.bound = false;
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
}

class FastCompiledElementTemplateView implements View {
  readonly bindings: Binding[] = [];
  readonly first: Node;
  readonly last: Node;
  private bound = false;
  private refreshEffect: EffectHandle | undefined;
  private readonly refreshers: Array<() => void> = [];
  private binders: Array<() => Cleanup | void> | undefined;
  private cleanups: Cleanup[] | undefined;

  constructor(
    private readonly nodes: Node[],
    private readonly root: Element | ShadowRoot,
    public readonly scope: Scope,
    private readonly host: CompiledBindingHost,
    plan: CompiledElementBindingPlan
  ) {
    this.first = nodes[0] ?? document.createComment('empty');
    this.last = nodes[nodes.length - 1] ?? this.first;
    let id = 0;
    for (const instruction of plan.instructions) {
      this.registerInstruction(++id, instruction);
    }
  }

  bind(): void {
    if (this.bound) return;
    this.bound = true;
    if (this.refreshers.length > 0) {
      this.refreshEffect = effect(() => this.refresh());
    }
    if (this.binders) {
      for (const binder of this.binders) {
        const cleanup = binder();
        if (cleanup) {
          this.cleanups ??= [];
          this.cleanups.push(cleanup);
        }
      }
    }
    for (const binding of this.bindings) {
      runBindingLifecycle(this.host, binding, 'bind', () => binding.bind());
    }
  }

  refresh(): void {
    for (const refresh of this.refreshers) {
      refresh();
    }
    for (const binding of this.bindings) {
      runBindingLifecycle(this.host, binding, 'refresh', () => binding.refresh());
    }
  }

  unbind(): void {
    if (!this.bound) return;
    this.refreshEffect?.stop();
    this.refreshEffect = undefined;
    const cleanups = this.cleanups;
    if (cleanups) {
      for (let index = cleanups.length - 1; index >= 0; index--) {
        cleanups[index]!();
      }
    }
    this.cleanups = undefined;
    for (let index = this.bindings.length - 1; index >= 0; index--) {
      const binding = this.bindings[index]!;
      runBindingLifecycle(this.host, binding, 'unbind', () => binding.unbind());
    }
    this.bound = false;
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

  private registerInstruction(id: number, instruction: CompiledElementInstruction): void {
    if (this.tryRegisterRefreshInstruction(instruction)) return;

    const binding = this.bindingForInstruction(id, instruction);
    if (binding instanceof BindingController) {
      binding.setDiagnostics(this.host);
    }
    this.bindings.push(binding);
  }

  private addRefresh(refresh: () => void): void {
    this.refreshers.push(refresh);
  }

  private onBind(callback: () => Cleanup | void): void {
    this.binders ??= [];
    this.binders.push(callback);
  }

  private tryRegisterRefreshInstruction(instruction: CompiledElementInstruction): boolean {
    const node = compiledNodeAtPath(this.root, instruction.path);

    switch (instruction.kind) {
      case 'text': {
        if (!(node instanceof Text)) throw new Error('Compiled element text path no longer points to text');
        const slot = new ValueSlot<string>();
        this.addRefresh(() => {
          const value = evaluateInterpolation(instruction.parts, this.scope);
          if (slot.shouldWrite(value)) {
            node.data = value;
          }
        });
        return true;
      }

      case 'attribute': {
        if (!(node instanceof Element)) throw new Error('Compiled element attribute path no longer points to an element');
        const slot = new ValueSlot<string>();
        this.addRefresh(() => {
          const value = evaluateInterpolation(instruction.parts, this.scope);
          if (slot.shouldWrite(value)) {
            writeAttribute(node, instruction.target, value);
          }
        });
        return true;
      }

      case 'class': {
        if (instruction.behaviorCalls.length > 0) return false;
        if (!(node instanceof Element)) throw new Error('Compiled element class path no longer points to an element');
        node.removeAttribute(instruction.attrName);
        const slot = new ValueSlot<boolean>();
        this.addRefresh(() => {
          const active = !!evaluateCompiledExpression(instruction.expression, this.scope);
          if (!slot.shouldWrite(active)) return;

          for (const token of instruction.tokens) {
            node.classList.toggle(token, active);
          }
        });
        return true;
      }

      case 'style': {
        if (instruction.behaviorCalls.length > 0) return false;
        if (!(node instanceof Element)) throw new Error('Compiled element style path no longer points to an element');
        node.removeAttribute(instruction.attrName);
        const style = (node as HTMLElement).style;
        const slot = new ValueSlot<unknown>();
        this.addRefresh(() => {
          const value = evaluateCompiledExpression(instruction.expression, this.scope);
          if (slot.shouldWrite(value)) {
            writeCompiledStyleProperty(style, instruction.property, value);
          }
        });
        return true;
      }

      case 'property': {
        if (instruction.behaviorCalls.length > 0) return false;
        if (!(node instanceof Element)) throw new Error('Compiled element property path no longer points to an element');
        const target = normalizeCompiledElementBindingTarget(instruction.target);
        const mode = resolveMode(instruction.command, node, target);
        if (mode !== BindingMode.toView) return false;

        node.removeAttribute(instruction.attrName);
        const write = createCompiledElementRefreshWriter(
          node,
          instruction.target,
          instruction.forceAttribute,
          this.host.dev
        );
        const slot = new ValueSlot<unknown>();
        this.addRefresh(() => {
          const value = evaluateCompiledExpression(instruction.expression, this.scope);
          if (slot.shouldWrite(value)) {
            write(value);
          }
        });
        return true;
      }

      case 'show': {
        if (!(node instanceof HTMLElement)) throw new Error('Compiled element show path no longer points to an HTMLElement');
        node.removeAttribute(instruction.attrName);
        const initialDisplay = node.style.display;
        const slot = new ValueSlot<boolean>();
        this.addRefresh(() => {
          const value = !!evaluateCompiledExpression(instruction.expression, this.scope);
          const visible = instruction.invert ? !value : value;
          if (slot.shouldWrite(visible)) {
            node.style.display = visible ? initialDisplay : 'none';
          }
        });
        return true;
      }

      case 'event':
        return this.tryRegisterEventInstruction(node, instruction);
    }
  }

  private tryRegisterEventInstruction(node: Node | null, instruction: Extract<CompiledElementInstruction, { kind: 'event' }>): boolean {
    if (instruction.behaviorCalls.length > 0) return false;
    if (instruction.syntax.command !== 'trigger') return false;
    if (instruction.syntax.modifiers.length > 0) return false;
    if (instruction.syntax.target === 'attached' || instruction.syntax.target === 'detaching') return false;
    if (!(node instanceof Element)) throw new Error('Compiled element event path no longer points to an element');

    node.removeAttribute(instruction.attrName);
    this.onBind(() => addOptimizedEventListener(node, instruction.syntax.target, event => {
      this.runEventInstruction(node, instruction, event);
    }));
    return true;
  }

  private runEventInstruction(
    element: Element,
    instruction: Extract<CompiledElementInstruction, { kind: 'event' }>,
    event: Event
  ): void {
    const locals = this.scope.locals;
    const hadEvent = Object.prototype.hasOwnProperty.call(locals, '$event');
    const previousEvent = locals.$event;
    locals.$event = event;
    try {
      evaluateCompiledExpression(instruction.expression, this.scope);
    } catch (error) {
      reportError(this.host, 'E_BINDING', error, {
        phase: 'event',
        event: event.type,
        expression: instruction.expression.source,
        target: describeCompiledElement(element)
      });
    } finally {
      if (hadEvent) {
        locals.$event = previousEvent;
      } else {
        delete locals.$event;
      }
    }
  }

  private bindingForInstruction(id: number, instruction: CompiledElementInstruction): Binding {
    const node = compiledNodeAtPath(this.root, instruction.path);
    switch (instruction.kind) {
      case 'text':
        if (!(node instanceof Text)) throw new Error('Compiled element text path no longer points to text');
        return new InterpolationBinding(
          id,
          instruction.parts,
          value => {
            node.data = value;
          },
          this.scope
        );

      case 'attribute': {
        if (!(node instanceof Element)) throw new Error('Compiled element attribute path no longer points to an element');
        const observer = new AttributeObserver(node, instruction.target);
        return new InterpolationBinding(
          id,
          instruction.parts,
          value => observer.write(value),
          this.scope
        );
      }

      case 'class': {
        if (!(node instanceof Element)) throw new Error('Compiled element class path no longer points to an element');
        node.removeAttribute(instruction.attrName);
        const behaviors = createBehaviorInstances(instruction.behaviorCalls, this.host.resources);
        return new PropertyBinding(
          id,
          getBehaviorMode(behaviors) ?? BindingMode.toView,
          instruction.expression,
          new TokenClassObserver(node, instruction.tokens),
          this.scope,
          behaviors
        );
      }

      case 'style': {
        if (!(node instanceof Element)) throw new Error('Compiled element style path no longer points to an element');
        node.removeAttribute(instruction.attrName);
        const behaviors = createBehaviorInstances(instruction.behaviorCalls, this.host.resources);
        return new PropertyBinding(
          id,
          getBehaviorMode(behaviors) ?? BindingMode.toView,
          instruction.expression,
          new StylePropertyObserver(node, instruction.property),
          this.scope,
          behaviors
        );
      }

      case 'property': {
        if (!(node instanceof Element)) throw new Error('Compiled element property path no longer points to an element');
        node.removeAttribute(instruction.attrName);
        const behaviors = createBehaviorInstances(instruction.behaviorCalls, this.host.resources);
        const target = normalizeCompiledElementBindingTarget(instruction.target);
        const mode = resolveMode(instruction.command, node, target, getBehaviorMode(behaviors));
        const forceAttribute = instruction.forceAttribute || shouldForceAttribute(behaviors);
        return new PropertyBinding(
          id,
          mode,
          instruction.expression,
          createCompiledElementObserver(node, instruction.target, observerOptions(forceAttribute, getUpdateEvents(behaviors, this.scope), this.host.dev)),
          this.scope,
          behaviors
        );
      }

      case 'show':
        if (!(node instanceof HTMLElement)) throw new Error('Compiled element show path no longer points to an HTMLElement');
        node.removeAttribute(instruction.attrName);
        return new ShowController(
          id,
          node,
          instruction.expression,
          this.scope,
          instruction.invert
        );

      case 'event': {
        if (!(node instanceof Element)) throw new Error('Compiled element event path no longer points to an element');
        node.removeAttribute(instruction.attrName);
        const behaviors = createBehaviorInstances(instruction.behaviorCalls, this.host.resources);
        return new EventBinding(
          id,
          node,
          instruction.syntax,
          instruction.expression,
          this.scope,
          behaviors
        );
      }
    }
  }
}

class CompiledElementLifecycleBinding extends BindingController {
  constructor(
    id: number,
    private readonly instance: Record<string, unknown>
  ) {
    super(id, BindingMode.oneTime);
  }

  bind(): void {
    callCompiledLifecycle(this.instance, 'binding');
    callCompiledLifecycle(this.instance, 'bound');
    callCompiledLifecycle(this.instance, 'attaching');
    callCompiledLifecycle(this.instance, 'attached');
  }

  refresh(): void {}

  override unbind(): void {
    callCompiledLifecycle(this.instance, 'detaching');
    callCompiledLifecycle(this.instance, 'unbinding');
    super.unbind();
  }
}

class CompiledDomViewBinding extends BindingController {
  constructor(
    id: number,
    private readonly view: View
  ) {
    super(id, BindingMode.oneTime);
  }

  bind(): void {
    this.view.bind();
  }

  refresh(): void {
    this.view.refresh();
  }

  override unbind(): void {
    this.view.unbind();
    super.unbind();
  }
}

function describeCompiledElement(element: Element): string {
  const id = element.id ? `#${element.id}` : '';
  const classes = element.className && typeof element.className === 'string'
    ? `.${element.className.trim().split(/\s+/).filter(Boolean).join('.')}`
    : '';
  return `${element.tagName.toLowerCase()}${id}${classes}`;
}

function callCompiledLifecycle(instance: Record<string, unknown>, name: string): void {
  const callback = instance[name];
  if (typeof callback === 'function') {
    callback.call(instance);
  }
}

function runBindingLifecycle(
  host: Pick<CompiledBindingHost, 'dev' | 'onError'>,
  binding: Binding,
  phase: string,
  callback: () => void
): void {
  if (binding instanceof BindingController) {
    binding.setDiagnostics(host);
    binding.runWithDiagnostics(phase, callback, {
      bindingId: binding.id,
      bindingMode: binding.mode
    });
    return;
  }
  callback();
}
