import type { IrBinding, IrTemplate, IrViewFactory } from './ir.js';
import { emitCompiledExpression } from './codegen-expression.js';
import { hydrationMarkerId } from './hydration-markers.js';

interface BindingEmitContext {
  expressions: string[];
  host: string;
  controllerMode: 'hydrateRange' | 'clientFactory';
  factoryRef(id: number): string;
}

type HydratableRangeControllerBinding =
  Extract<IrBinding, { kind: 'templateController' }> & { controller: 'if' | 'repeat' | 'with' | 'switch' | 'promise' };

export function emitHydrateModule(ir: IrTemplate): string {
  if (!canEmitDirectHydrate(ir)) return emitRuntimeBackedHydrateModule(ir);

  const context: BindingEmitContext = {
    expressions: ir.expressions.map(expression => expression.source),
    host: 'app',
    controllerMode: 'hydrateRange',
    factoryRef: id => factoryName([id])
  };
  const nodeDecls = nodePaths(ir.bindings, false)
    .map(({ name, path }) => `  const ${name} = hydratePath(target, ${JSON.stringify(path)});`)
    .join('\n');
  const bindingCalls = ir.bindings
    .map(binding => `  ${bindingCall(binding, context)}`)
    .join('\n');
  const factoryDefinitions = emitFactoryDefinitions(ir.factories, []);

  return [
    "import {",
    "  bindAttributeCompiled,",
    "  bindClassCompiled,",
    "  bindEventCompiled,",
    "  bindIfCompiled,",
    "  bindLetCompiled,",
    "  bindPromiseCompiled,",
    "  bindPropertyCompiled,",
    "  bindRefCompiled,",
    "  bindRepeatCompiled,",
    "  bindShowCompiled,",
    "  bindSpreadCompiled,",
    "  bindStyleCompiled,",
    "  bindSwitchCompiled,",
    "  bindTextCompiled,",
    "  bindWithCompiled,",
    "  createCompiledApp,",
    "  createCompiledViewFactory,",
    "  createTemplate,",
    "  getIdentifier,",
    "  path,",
    "  setIdentifier",
    "} from '@lami.js/runtime/internal';",
    `export const metadata = ${JSON.stringify(ir, null, 2)};`,
    factoryDefinitions,
    hydrationHelpers,
    'export function hydrate(target, model, options = {}) {',
    '  const app = createCompiledApp(target, model, options);',
    nodeDecls,
    bindingCalls,
    '  app.bind();',
    '  return app;',
    '}',
    'export const mount = hydrate;'
  ].filter(Boolean).join('\n');
}

export function canEmitDirectHydrate(ir: IrTemplate): boolean {
  return canHydrateRootBindings(ir.bindings) &&
    ir.factories.every(canEmitHydrateFactory);
}

function emitRuntimeBackedHydrateModule(ir: IrTemplate): string {
  return [
    "import { enhance } from '@lami.js/runtime';",
    `export const metadata = ${JSON.stringify(ir, null, 2)};`,
    'export function hydrate(target, model, options = {}) {',
    '  return enhance(target, model, options);',
    '}',
    'export const mount = hydrate;'
  ].join('\n');
}

function bindingCall(binding: IrBinding, context: BindingEmitContext): string {
  const node = nodeName(binding.path);
  switch (binding.kind) {
    case 'text':
      return `bindTextCompiled(${context.host}, ${node}, ${interpolationArg(binding.parts, context)});`;
    case 'attributeInterpolation':
      return `bindAttributeCompiled(${context.host}, ${node}, ${JSON.stringify(binding.target)}, ${interpolationArg(binding.parts, context)});`;
    case 'class':
      return `bindClassCompiled(${context.host}, ${node}, ${JSON.stringify(binding.tokens)}, ${expressionArg(context, binding.expressionId)});`;
    case 'property':
      return `bindPropertyCompiled(${context.host}, ${node}, ${JSON.stringify(binding.target)}, ${JSON.stringify(binding.mode)}, ${expressionArg(context, binding.expressionId)}, ${JSON.stringify(binding.forceAttribute)});`;
    case 'show':
      return `bindShowCompiled(${context.host}, ${node}, ${expressionArg(context, binding.expressionId)}, ${JSON.stringify(binding.invert)});`;
    case 'style':
      return `bindStyleCompiled(${context.host}, ${node}, ${JSON.stringify(binding.property)}, ${expressionArg(context, binding.expressionId)});`;
    case 'event':
      return `bindEventCompiled(${context.host}, ${node}, ${JSON.stringify(binding.eventName)}, ${JSON.stringify(binding.capture)}, ${JSON.stringify(binding.modifiers)}, ${expressionArg(context, binding.expressionId)});`;
    case 'let':
      return `bindLetCompiled(${context.host}, ${JSON.stringify(binding.property)}, ${expressionArg(context, binding.expressionId)}, ${JSON.stringify(binding.toBindingContext)});`;
    case 'ref':
      return `bindRefCompiled(${context.host}, ${JSON.stringify(binding.property)}, ${node});`;
    case 'spread':
      return `bindSpreadCompiled(${context.host}, ${node}, ${JSON.stringify(context.expressions[binding.expressionId])});`;
    case 'templateController':
      return context.controllerMode === 'hydrateRange'
        ? hydrateTemplateControllerCall(binding, context)
        : clientTemplateControllerCall(binding, node, context);
  }
}

function hydrateTemplateControllerCall(
  binding: Extract<IrBinding, { kind: 'templateController' }>,
  context: BindingEmitContext
): string {
  if (!isHydratableRangeController(binding)) {
    throw new Error('Template controller is emitted through the runtime-backed hydrate module path for now');
  }

  const source = context.expressions[binding.expressionId]!;
  const marker = hydrationMarkerId(binding.controller, binding.path, source);
  if (binding.controller === 'repeat') {
    return `hydrateRepeatController(${context.host}, target, ${JSON.stringify(marker)}, ${JSON.stringify(source)}, ${context.factoryRef(binding.factoryId!)}(${context.host}));`;
  }
  if (binding.controller === 'with') {
    return `hydrateWithController(${context.host}, target, ${JSON.stringify(marker)}, ${JSON.stringify(source)}, ${context.factoryRef(binding.factoryId!)}(${context.host}));`;
  }
  if (binding.controller === 'switch') {
    return switchControllerCall(binding, marker, context);
  }
  if (binding.controller === 'promise') {
    return promiseControllerCall(binding, marker, context);
  }

  const elseFactory = binding.elseFactoryId === undefined
    ? 'null'
    : `${context.factoryRef(binding.elseFactoryId)}(${context.host})`;
  return `hydrateIfController(${context.host}, target, ${JSON.stringify(marker)}, ${JSON.stringify(source)}, ${context.factoryRef(binding.factoryId!)}(${context.host}), ${elseFactory});`;
}

function switchControllerCall(
  binding: Extract<IrBinding, { kind: 'templateController' }>,
  marker: string,
  context: BindingEmitContext
): string {
  const cases = (binding.cases ?? []).map(item => {
    const factory = `${context.factoryRef(item.factoryId)}(${context.host})`;
    if (item.match.type === 'literal') {
      return `{ factory: ${factory}, value: ${JSON.stringify(item.match.value)} }`;
    }
    return `{ factory: ${factory}, source: ${JSON.stringify(context.expressions[item.match.expressionId])} }`;
  });
  const defaultFactory = binding.defaultFactoryId === undefined
    ? 'null'
    : `${context.factoryRef(binding.defaultFactoryId)}(${context.host})`;
  return `hydrateSwitchController(${context.host}, target, ${JSON.stringify(marker)}, ${JSON.stringify(context.expressions[binding.expressionId])}, [${cases.join(', ')}], ${defaultFactory});`;
}

function promiseControllerCall(
  binding: Extract<IrBinding, { kind: 'templateController' }>,
  marker: string,
  context: BindingEmitContext
): string {
  const branches = binding.promise;
  const parts: string[] = [];
  if (branches?.pendingFactoryId !== undefined) {
    parts.push(`pending: ${context.factoryRef(branches.pendingFactoryId)}(${context.host})`);
  }
  if (branches?.then) {
    parts.push(`then: { local: ${JSON.stringify(branches.then.local)}, factory: ${context.factoryRef(branches.then.factoryId)}(${context.host}) }`);
  }
  if (branches?.catch) {
    parts.push(`catch: { local: ${JSON.stringify(branches.catch.local)}, factory: ${context.factoryRef(branches.catch.factoryId)}(${context.host}) }`);
  }
  return `hydratePromiseController(${context.host}, target, ${JSON.stringify(marker)}, ${JSON.stringify(context.expressions[binding.expressionId])}, { ${parts.join(', ')} });`;
}

function clientTemplateControllerCall(
  binding: Extract<IrBinding, { kind: 'templateController' }>,
  node: string,
  context: BindingEmitContext
): string {
  switch (binding.controller) {
    case 'if': {
      const elseFactory = binding.elseFactoryId === undefined
        ? 'null'
        : `${context.factoryRef(binding.elseFactoryId)}(${context.host})`;
      return `bindIfCompiled(${context.host}, ${node}, ${JSON.stringify(context.expressions[binding.expressionId])}, ${context.factoryRef(binding.factoryId!)}(${context.host}), ${elseFactory});`;
    }
    case 'repeat':
      return `bindRepeatCompiled(${context.host}, ${node}, ${JSON.stringify(context.expressions[binding.expressionId])}, ${context.factoryRef(binding.factoryId!)}(${context.host}));`;
    case 'with':
      return `bindWithCompiled(${context.host}, ${node}, ${JSON.stringify(context.expressions[binding.expressionId])}, ${context.factoryRef(binding.factoryId!)}(${context.host}));`;
    case 'switch':
      return clientSwitchControllerCall(binding, node, context);
    case 'promise':
      return clientPromiseControllerCall(binding, node, context);
  }
}

function clientSwitchControllerCall(
  binding: Extract<IrBinding, { kind: 'templateController' }>,
  node: string,
  context: BindingEmitContext
): string {
  const cases = (binding.cases ?? []).map(item => {
    const factory = `${context.factoryRef(item.factoryId)}(${context.host})`;
    if (item.match.type === 'literal') {
      return `{ factory: ${factory}, value: ${JSON.stringify(item.match.value)} }`;
    }
    return `{ factory: ${factory}, source: ${JSON.stringify(context.expressions[item.match.expressionId])} }`;
  });
  const defaultFactory = binding.defaultFactoryId === undefined
    ? 'null'
    : `${context.factoryRef(binding.defaultFactoryId)}(${context.host})`;
  return `bindSwitchCompiled(${context.host}, ${node}, ${JSON.stringify(context.expressions[binding.expressionId])}, [${cases.join(', ')}], ${defaultFactory});`;
}

function clientPromiseControllerCall(
  binding: Extract<IrBinding, { kind: 'templateController' }>,
  node: string,
  context: BindingEmitContext
): string {
  const branches = binding.promise;
  const parts: string[] = [];
  if (branches?.pendingFactoryId !== undefined) {
    parts.push(`pending: ${context.factoryRef(branches.pendingFactoryId)}(${context.host})`);
  }
  if (branches?.then) {
    parts.push(`then: { local: ${JSON.stringify(branches.then.local)}, factory: ${context.factoryRef(branches.then.factoryId)}(${context.host}) }`);
  }
  if (branches?.catch) {
    parts.push(`catch: { local: ${JSON.stringify(branches.catch.local)}, factory: ${context.factoryRef(branches.catch.factoryId)}(${context.host}) }`);
  }

  return `bindPromiseCompiled(${context.host}, ${node}, ${JSON.stringify(context.expressions[binding.expressionId])}, { ${parts.join(', ')} });`;
}

function emitFactoryDefinitions(factories: IrViewFactory[], prefix: number[]): string {
  return factories
    .flatMap(factory => {
      const nextPrefix = [...prefix, factory.id];
      const name = factoryName(nextPrefix);
      const bindName = `bind_${name}`;
      const templateName = `${name}_template`;
      const context: BindingEmitContext = {
        expressions: expressionSources(factory),
        host: 'view',
        controllerMode: 'clientFactory',
        factoryRef: id => factoryName([...nextPrefix, id])
      };
      const nodeDecls = nodePaths(factory.bindings, true)
        .map(({ name: node, path }) => `  const ${node} = path(fragment, ${JSON.stringify(path)});`)
        .join('\n');
      const bindingCalls = factory.bindings
        .map(binding => `  ${bindingCall(binding, context)}`)
        .join('\n');

      return [
        `const ${templateName} = createTemplate(${JSON.stringify(factory.staticHtml)});`,
        `function ${name}(host) {`,
        `  return createCompiledViewFactory(host, ${templateName}, ${bindName});`,
        '}',
        `function ${bindName}(view, fragment) {`,
        nodeDecls,
        bindingCalls,
        '}',
        emitFactoryDefinitions(factory.factories, nextPrefix)
      ];
    })
    .filter(Boolean)
    .join('\n');
}

function interpolationArg(
  parts: Extract<IrBinding, { kind: 'text' | 'attributeInterpolation' }>['parts'],
  context: BindingEmitContext
): string {
  return `[${parts.map(part => part.type === 'text'
    ? JSON.stringify(part)
    : `{ type: "expression", source: ${expressionArg(context, part.expressionId)} }`).join(', ')}]`;
}

function expressionArg(context: BindingEmitContext, expressionId: number): string {
  return emitCompiledExpression(context.expressions[expressionId]!);
}

function expressionSources(template: Pick<IrTemplate, 'expressions'> | Pick<IrViewFactory, 'expressions'>): string[] {
  return template.expressions.map(expression => expression.source);
}

function nodePaths(bindings: IrBinding[], includeTemplateControllers: boolean): Array<{ name: string; path: number[] }> {
  const paths = new Map<string, number[]>();
  for (const binding of bindings) {
    if (binding.kind === 'let') continue;
    if (binding.kind === 'templateController' && !includeTemplateControllers) continue;
    paths.set(binding.path.join('.'), binding.path);
  }
  return [...paths.values()].map(path => ({ name: nodeName(path), path }));
}

function nodeName(path: number[]): string {
  return `node_${path.length ? path.join('_') : 'root'}`;
}

function factoryName(path: number[]): string {
  return `factory_${path.join('_')}`;
}

function canEmitHydrateFactory(factory: IrViewFactory): boolean {
  return canEmitClientFactoryBindings(factory.bindings) && factory.factories.every(canEmitHydrateFactory);
}

function canEmitClientFactoryBindings(bindings: IrBinding[]): boolean {
  return bindings.every(binding => binding.kind !== 'templateController' || isHydratableRangeController(binding));
}

function canHydrateRootBindings(bindings: IrBinding[]): boolean {
  return bindings.every(binding => binding.kind !== 'templateController' || isHydratableRangeController(binding));
}

function isHydratableRangeController(
  binding: IrBinding
): binding is HydratableRangeControllerBinding {
  return binding.kind === 'templateController' &&
    (binding.controller === 'if' ||
      binding.controller === 'repeat' ||
      binding.controller === 'with' ||
      binding.controller === 'switch' ||
      binding.controller === 'promise');
}

const hydrationHelpers = `
function hydratePath(root, indexes) {
  let cursor = root;
  for (const index of indexes) {
    const children = logicalChildren(cursor);
    const next = children[index];
    if (!next) {
      throw new Error('Hydration DOM path ' + indexes.join('.') + ' could not be resolved');
    }
    cursor = next;
  }
  return cursor;
}

function logicalChildren(parent) {
  const nodes = [];
  let node = parent.firstChild;
  while (node) {
    nodes.push(node);
    if (isHydrationRangeStart(node)) {
      node = matchingRangeEnd(node) ?? node;
    }
    node = node.nextSibling;
  }
  return nodes;
}

function isHydrationRangeStart(node) {
  return node.nodeType === Node.COMMENT_NODE &&
    node.data.startsWith('lami:') &&
    node.data.endsWith(':start');
}

function matchingRangeEnd(start) {
  const data = start.data.slice(0, -':start'.length) + ':end';
  let node = start.nextSibling;
  while (node) {
    if (node.nodeType === Node.COMMENT_NODE && node.data === data) return node;
    node = node.nextSibling;
  }
  return null;
}

function hydrateIfController(app, target, markerId, source, ifFactory, elseFactory) {
  const range = markerRange(target, markerId);
  clearHydrationRange(range.start, range.end);
  bindIfCompiled(app, range.end, source, ifFactory, elseFactory);
}

function hydrateRepeatController(app, target, markerId, source, factory) {
  const range = markerRange(target, markerId);
  clearHydrationRange(range.start, range.end);
  bindRepeatCompiled(app, range.end, source, factory);
}

function hydrateWithController(app, target, markerId, source, factory) {
  const range = markerRange(target, markerId);
  clearHydrationRange(range.start, range.end);
  bindWithCompiled(app, range.end, source, factory);
}

function hydrateSwitchController(app, target, markerId, source, cases, defaultFactory) {
  const range = markerRange(target, markerId);
  clearHydrationRange(range.start, range.end);
  bindSwitchCompiled(app, range.end, source, cases, defaultFactory);
}

function hydratePromiseController(app, target, markerId, source, branches) {
  const range = markerRange(target, markerId);
  clearHydrationRange(range.start, range.end);
  bindPromiseCompiled(app, range.end, source, branches);
}

function markerRange(root, markerId) {
  const start = findComment(root, 'lami:' + markerId + ':start');
  const end = findComment(root, 'lami:' + markerId + ':end');
  if (!start || !end) {
    throw new Error('Hydration marker "' + markerId + '" could not be found');
  }
  if (start.parentNode !== end.parentNode) {
    throw new Error('Hydration marker "' + markerId + '" spans multiple parents');
  }
  return { start, end };
}

function clearHydrationRange(start, end) {
  let node = start.nextSibling;
  while (node && node !== end) {
    const next = node.nextSibling;
    node.parentNode?.removeChild(node);
    node = next;
  }
}

function findComment(root, data) {
  const ownerDocument = root.ownerDocument ?? document;
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  let node = walker.nextNode();
  while (node) {
    if (node.data === data) return node;
    node = walker.nextNode();
  }
  return null;
}
`;
