import type { IrBinding, IrTemplate, IrViewFactory } from './ir.js';
import type { AstElement, AstNode } from './ast.js';
import { parseTemplateAst } from './parse-html.js';
import {
  canAssignCompiledExpression,
  canEmitCompiledExpression,
  collectCompiledExpressionIdentifiers,
  emitCompiledExpression
} from './codegen-expression.js';

interface BindingEmitContext {
  expressions: string[];
  factories: IrViewFactory[];
  host: string;
  localNames: ReadonlySet<string>;
  factoryRef(id: number): string;
}

export function emitDomModule(source: string, ir: IrTemplate): string {
  if (!canEmitDirectDom(ir)) return emitRuntimeBackedDomModule(source, ir);

  const customElementPaths = collectRootCustomElementPaths(source);
  const rootContext: BindingEmitContext = {
    expressions: expressionSources(ir),
    factories: ir.factories,
    host: 'app',
    localNames: new Set(),
    factoryRef: id => factoryName([id])
  };
  const nodeDecls = nodePaths(ir.bindings, customElementPaths)
    .map(({ name, path }) => `  const ${name} = path(fragment, ${JSON.stringify(path)});`)
    .join('\n');
  const prepareCustomElements = customElementPaths
    .map(path => `  prepareCustomElementCompiled(app, ${nodeName(path)});`)
    .join('\n');
  const bindingCalls = ir.bindings
    .map(binding => `  ${bindingCall(binding, rootContext)}`)
    .join('\n');
  const bindCustomElements = customElementPaths
    .map(path => `  bindCustomElementCompiled(app, ${nodeName(path)});`)
    .join('\n');
  const factoryDefinitions = emitFactoryDefinitions(ir.factories, [], ir.bindings, rootContext.expressions);

  return [
    "import {",
    "  addOptimizedEventListener,",
    "  bindAttributeCompiled,",
    "  bindClassCompiled,",
    "  bindClassOptimizedCompiled,",
    "  bindCustomElementCompiled,",
    "  bindEventCompiled,",
    "  bindIfCompiled,",
    "  bindLetCompiled,",
    "  bindPromiseCompiled,",
    "  bindPropertyCompiled,",
    "  bindPropertyOptimizedCompiled,",
    "  bindRefCompiled,",
    "  bindRepeatCompiled,",
    "  bindRepeatOptimizedCompiled,",
    "  bindShowCompiled,",
    "  bindSpreadCompiled,",
    "  bindStyleCompiled,",
    "  bindSwitchCompiled,",
    "  bindTextCompiled,",
    "  bindTextOptimizedCompiled,",
    "  bindWithCompiled,",
    "  createCompiledApp,",
    "  createCompiledViewFactory,",
    "  createOptimizedRepeatRow,",
    "  createOptimizedRepeatRowFromNodes,",
    "  createTemplate,",
    "  getIdentifier,",
    "  path,",
    "  prepareCustomElementCompiled,",
    "  setIdentifier",
    "} from '@lami.js/runtime/internal';",
    `export const metadata = ${JSON.stringify(ir, null, 2)};`,
    `const template = createTemplate(${JSON.stringify(ir.staticHtml)});`,
    factoryDefinitions,
    'export function mount(target, model, options = {}) {',
    '  const app = createCompiledApp(target, model, { ...options, clearRootOnDispose: true });',
    '  const fragment = template.clone();',
    nodeDecls,
    prepareCustomElements,
    bindingCalls,
    bindCustomElements,
    '  target.append(fragment);',
    '  app.bind();',
    '  return app;',
    '}'
  ].filter(Boolean).join('\n');
}

export function canEmitDirectDom(ir: IrTemplate): boolean {
  return canEmitBindings(ir.bindings) && ir.factories.every(canEmitFactory);
}

export function emitRuntimeBackedDomModule(source: string, ir: IrTemplate): string {
  return [
    "import { enhance } from '@lami.js/runtime';",
    `export const metadata = ${JSON.stringify(ir, null, 2)};`,
    `const templateSource = ${JSON.stringify(source)};`,
    'export function mount(target, model, options = {}) {',
    "  const template = document.createElement('template');",
    '  template.innerHTML = templateSource;',
    '  const fragment = template.content.cloneNode(true);',
    '  target.append(fragment);',
    '  return enhance(target, model, options);',
    '}'
  ].join('\n');
}

function emitFactoryDefinitions(
  factories: IrViewFactory[],
  prefix: number[],
  ownerBindings: IrBinding[],
  ownerExpressions: string[]
): string {
  return factories
    .flatMap(factory => {
      const nextPrefix = [...prefix, factory.id];
      const name = factoryName(nextPrefix);
      const bindName = `bind_${name}`;
      const templateName = `${name}_template`;
      const context: BindingEmitContext = {
        expressions: expressionSources(factory),
        factories: factory.factories,
        host: 'view',
        localNames: localNamesForFactory(factory.id, ownerBindings, ownerExpressions),
        factoryRef: id => factoryName([...nextPrefix, id])
      };
      const customElementPaths = collectCustomElementPaths(factory.ast);
      const nodeDecls = nodePaths(factory.bindings, customElementPaths)
        .map(({ name: node, path }) => `  const ${node} = path(fragment, ${JSON.stringify(path)});`)
        .join('\n');
      const prepareCustomElements = customElementPaths
        .map(path => `  prepareCustomElementCompiled(view, ${nodeName(path)});`)
        .join('\n');
      const bindingCalls = factory.bindings
        .map(binding => `  ${bindingCall(binding, context)}`)
        .join('\n');
      const bindCustomElements = customElementPaths
        .map(path => `  bindCustomElementCompiled(view, ${nodeName(path)});`)
        .join('\n');
      const nestedFactories = emitFactoryDefinitions(factory.factories, nextPrefix, factory.bindings, context.expressions);
      const rowFactoryDefinition = canEmitOptimizedRowFactory(factory, context)
        ? emitOptimizedRowFactory(factory, context, name, templateName)
        : '';

      return [
        `const ${templateName} = createTemplate(${JSON.stringify(factory.staticHtml)});`,
        `function ${name}(host) {`,
        `  return createCompiledViewFactory(host, ${templateName}, ${bindName});`,
        '}',
        rowFactoryDefinition,
        `function ${bindName}(view, fragment) {`,
        nodeDecls,
        prepareCustomElements,
        bindingCalls,
        bindCustomElements,
        '}',
        nestedFactories
      ];
    })
    .filter(Boolean)
    .join('\n');
}

function bindingCall(binding: IrBinding, context: BindingEmitContext): string {
  const node = nodeName(binding.path);
  switch (binding.kind) {
    case 'text':
      if (canOptimizeBinding(binding, context)) {
        return `bindTextOptimizedCompiled(${context.host}, ${node}, ${interpolationArg(binding.parts, context)});`;
      }
      return `bindTextCompiled(${context.host}, ${node}, ${interpolationArg(binding.parts, context)});`;
    case 'attributeInterpolation':
      return `bindAttributeCompiled(${context.host}, ${node}, ${JSON.stringify(binding.target)}, ${interpolationArg(binding.parts, context)});`;
    case 'class':
      if (canOptimizeBinding(binding, context)) {
        return `bindClassOptimizedCompiled(${context.host}, ${node}, ${JSON.stringify(binding.tokens)}, ${expressionArg(context, binding.expressionId)});`;
      }
      return `bindClassCompiled(${context.host}, ${node}, ${JSON.stringify(binding.tokens)}, ${expressionArg(context, binding.expressionId)});`;
    case 'property':
      if (canOptimizeBinding(binding, context)) {
        return `bindPropertyOptimizedCompiled(${context.host}, ${node}, ${JSON.stringify(binding.target)}, ${JSON.stringify(binding.mode)}, ${expressionArg(context, binding.expressionId)}, ${JSON.stringify(binding.forceAttribute)});`;
      }
      return `bindPropertyCompiled(${context.host}, ${node}, ${JSON.stringify(binding.target)}, ${JSON.stringify(binding.mode)}, ${expressionArg(context, binding.expressionId)}, ${JSON.stringify(binding.forceAttribute)});`;
    case 'show':
      return `bindShowCompiled(${context.host}, ${node}, ${expressionArg(context, binding.expressionId)}, ${JSON.stringify(binding.invert)});`;
    case 'style':
      return `bindStyleCompiled(${context.host}, ${node}, ${JSON.stringify(binding.property)}, ${expressionArg(context, binding.expressionId)});`;
    case 'event':
      return `bindEventCompiled(${context.host}, ${node}, ${JSON.stringify(binding.eventName)}, ${JSON.stringify(binding.capture)}, ${JSON.stringify(binding.modifiers)}, ${expressionArg(context, binding.expressionId, false)});`;
    case 'let':
      return `bindLetCompiled(${context.host}, ${JSON.stringify(binding.property)}, ${expressionArg(context, binding.expressionId)}, ${JSON.stringify(binding.toBindingContext)});`;
    case 'ref':
      return `bindRefCompiled(${context.host}, ${JSON.stringify(binding.property)}, ${node});`;
    case 'spread':
      return `bindSpreadCompiled(${context.host}, ${node}, ${JSON.stringify(context.expressions[binding.expressionId])});`;
    case 'templateController':
      return templateControllerCall(binding, node, context);
  }
}

function canOptimizeBinding(binding: IrBinding, context: BindingEmitContext): boolean {
  if (context.host !== 'view') return false;

  switch (binding.kind) {
    case 'text':
      return binding.parts.every(part => (
        part.type === 'text' ||
        canEmitCompiledExpression(context.expressions[part.expressionId]!)
      ));
    case 'class':
    case 'property':
      return canEmitCompiledExpression(context.expressions[binding.expressionId]!);
    default:
      return false;
  }
}

function canEmitOptimizedRepeat(
  binding: Extract<IrBinding, { kind: 'templateController' }>,
  context: BindingEmitContext
): boolean {
  if (binding.controller !== 'repeat' || binding.factoryId === undefined) return false;
  if (!repeatHasSimplePattern(context.expressions[binding.expressionId] ?? '')) return false;
  const factory = context.factories.find(entry => entry.id === binding.factoryId);
  return factory ? canEmitOptimizedRowFactory(factory, {
    expressions: expressionSources(factory),
    factories: factory.factories,
    host: 'view',
    localNames: localNamesForFactory(factory.id, [binding], context.expressions),
    factoryRef: id => context.factoryRef(id)
  }) : false;
}

function canEmitOptimizedRowFactory(factory: IrViewFactory, context: BindingEmitContext): boolean {
  return factory.ast.kind === 'element' &&
    !hasCustomElementCandidate(factory.ast) &&
    factory.factories.length === 0 &&
    factory.bindings.length > 0 &&
    factory.bindings.every(binding => canEmitOptimizedRowBinding(binding, context));
}

function canEmitOptimizedRowBinding(binding: IrBinding, context: BindingEmitContext): boolean {
  switch (binding.kind) {
    case 'text':
      return binding.parts.every(part => (
        part.type === 'text' ||
        canEmitCompiledExpression(context.expressions[part.expressionId]!)
      ));
    case 'class':
      return canEmitCompiledExpression(context.expressions[binding.expressionId]!);
    case 'show':
      return canEmitCompiledExpression(context.expressions[binding.expressionId]!);
    case 'property': {
      const mode = String(binding.mode);
      return binding.target === 'checked' &&
        (mode === 'toView' || mode === 'twoWay') &&
        canEmitCompiledExpression(context.expressions[binding.expressionId]!) &&
        (mode !== 'twoWay' || canAssignCompiledExpression(context.expressions[binding.expressionId]!));
    }
    case 'event':
      return !binding.capture &&
        !isLifecycleEventName(binding.eventName) &&
        binding.modifiers.length === 0 &&
        canEmitCompiledExpression(context.expressions[binding.expressionId]!);
    default:
      return false;
  }
}

function emitOptimizedRowFactory(
  factory: IrViewFactory,
  context: BindingEmitContext,
  name: string,
  templateName: string
): string {
  const counter = { value: 0 };
  const classBindingsByPath = countClassBindingsByPath(factory.bindings);
  const nodeDecls = optimizedRowNodePaths(factory.bindings)
    .filter(({ path }) => path.length > 1)
    .map(({ name: node, path }) => `    const ${node} = ${domPathExpression('node_0', path.slice(1))};`)
    .join('\n');
  const outerLines: string[] = [];
  const setupLines: string[] = [];
  const refreshLines: string[] = ['      const scope = row.scope;', '      const locals = scope.locals;'];

  for (const binding of factory.bindings) {
    emitOptimizedRowBinding(binding, factory, classBindingsByPath, context, outerLines, setupLines, refreshLines, counter);
  }

  return [
    `function ${name}_row(host) {`,
    outerLines.join('\n'),
    `  return function create_${name}_row() {`,
    `    const node_0 = ${templateName}.cloneFirstChild();`,
    nodeDecls,
    `    const row = createOptimizedRepeatRowFromNodes(host, [node_0]);`,
    setupLines.join('\n'),
    `    row.setRefresh(() => {`,
    refreshLines.join('\n'),
    `    });`,
    `    return row;`,
    `  };`,
    `}`
  ].filter(Boolean).join('\n');
}

function emitOptimizedRowBinding(
  binding: IrBinding,
  factory: IrViewFactory,
  classBindingsByPath: ReadonlyMap<string, number>,
  context: BindingEmitContext,
  outerLines: string[],
  setupLines: string[],
  refreshLines: string[],
  counter: { value: number }
): void {
  const node = nodeName(binding.path);
  const id = counter.value++;
  const expr = `expr_${id}`;
  const slot = `value_${id}`;
  const next = `next_${id}`;

  switch (binding.kind) {
    case 'class':
      const classValue = rowExpression(context.expressions[binding.expressionId]!, context, expr, outerLines);
      const fastClassName = simpleClassNameFastPath(factory, binding, classBindingsByPath);
      if (binding.tokens.length === 1) {
        setupLines.push(fastClassName
          ? `    let ${slot} = false;`
          : `    let ${slot} = ${node}.classList.contains(${JSON.stringify(binding.tokens[0])});`);
      } else {
        const tokenList = JSON.stringify(binding.tokens);
        setupLines.push(`    const tokens_${id} = ${tokenList};`);
        setupLines.push(`    let ${slot} = tokens_${id}.every(token => ${node}.classList.contains(token)) ? true : tokens_${id}.some(token => ${node}.classList.contains(token)) ? undefined : false;`);
      }
      refreshLines.push(`      const ${next} = !!(${classValue});`);
      refreshLines.push(`      if (${slot} !== ${next}) {`);
      refreshLines.push(`        ${slot} = ${next};`);
      if (fastClassName) {
        refreshLines.push(`        ${node}.className = ${next} ? ${JSON.stringify(fastClassName)} : "";`);
      } else {
        for (const token of binding.tokens) {
          refreshLines.push(`        ${node}.classList.toggle(${JSON.stringify(token)}, ${next});`);
        }
      }
      refreshLines.push(`      }`);
      return;

    case 'show':
      const showValue = rowExpression(context.expressions[binding.expressionId]!, context, expr, outerLines);
      const display = `display_${id}`;
      setupLines.push(`    const ${display} = ${node}.style.display;`);
      setupLines.push(`    let ${slot};`);
      refreshLines.push(`      const ${next} = ${binding.invert ? '!' : ''}!!(${showValue});`);
      refreshLines.push(`      if (${slot} !== ${next}) {`);
      refreshLines.push(`        ${slot} = ${next};`);
      refreshLines.push(`        ${node}.style.display = ${next} ? ${display} : "none";`);
      refreshLines.push(`      }`);
      return;

    case 'property':
      const propertySource = context.expressions[binding.expressionId]!;
      const propertyValue = rowExpression(propertySource, context, expr, outerLines);
      setupLines.push(simpleCheckedFastPath(factory, binding)
        ? `    let ${slot} = false;`
        : `    let ${slot} = ${node}.checked;`);
      refreshLines.push(`      const ${next} = !!(${propertyValue});`);
      refreshLines.push(`      if (${slot} !== ${next}) {`);
      refreshLines.push(`        ${slot} = ${next};`);
      refreshLines.push(`        ${node}.checked = ${next};`);
      refreshLines.push(`      }`);
      if (String(binding.mode) === 'twoWay') {
        const update = `update_${id}`;
        setupLines.push(`    const ${update} = () => {`);
        setupLines.push(`      const scope = row.scope;`);
        setupLines.push(`      ${rowAssign(propertySource, context, `${node}.checked`, expr, outerLines)}`);
        setupLines.push(`      ${slot} = ${node}.checked;`);
        setupLines.push(`    };`);
        setupLines.push(`    row.onBind(() => addOptimizedEventListener(${node}, 'change', ${update}));`);
      }
      return;

    case 'event': {
      const eventSource = context.expressions[binding.expressionId]!;
      const eventValue = rowExpression(eventSource, context, expr, outerLines);
      const handler = `event_${id}`;
      setupLines.push(`    const ${handler} = event => {`);
      setupLines.push(`      const scope = row.scope;`);
      setupLines.push(`      const locals = scope.locals;`);
      setupLines.push(`      const hadEvent = Object.prototype.hasOwnProperty.call(locals, "$event");`);
      setupLines.push(`      const previousEvent = locals.$event;`);
      setupLines.push(`      locals.$event = event;`);
      setupLines.push(`      try {`);
      setupLines.push(`        ${eventValue};`);
      setupLines.push(`      } finally {`);
      setupLines.push(`        if (hadEvent) locals.$event = previousEvent;`);
      setupLines.push(`        else delete locals.$event;`);
      setupLines.push(`      }`);
      setupLines.push(`    };`);
      setupLines.push(`    row.onBind(() => addOptimizedEventListener(${node}, ${JSON.stringify(binding.eventName)}, ${handler}));`);
      return;
    }

    case 'text': {
      const nextValue = optimizedTextValue(binding.parts, context, outerLines, counter);
      setupLines.push(`    let ${slot};`);
      refreshLines.push(`      const ${next} = ${nextValue};`);
      refreshLines.push(`      if (${slot} !== ${next}) {`);
      refreshLines.push(`        ${slot} = ${next};`);
      refreshLines.push(`        ${node}.data = ${next};`);
      refreshLines.push(`      }`);
      return;
    }
  }
}

function optimizedTextValue(
  parts: Extract<IrBinding, { kind: 'text' }>['parts'],
  context: BindingEmitContext,
  outerLines: string[],
  counter: { value: number }
): string {
  const pieces = parts.map(part => {
    if (part.type === 'text') return JSON.stringify(part.value);
    const partId = counter.value++;
    const source = context.expressions[part.expressionId]!;
    const value = rowExpression(source, context, `expr_${partId}`, outerLines);
    return stringifyCode(value);
  });
  return pieces.join(' + ') || '""';
}

function rowExpression(
  source: string,
  context: BindingEmitContext,
  fallbackName: string,
  outerLines: string[]
): string {
  const fast = fastLocalExpression(source, context.localNames, 'locals');
  if (fast) return fast;

  outerLines.push(`  const ${fallbackName} = ${expressionArg(context, context.expressions.indexOf(source))};`);
  return `${fallbackName}.evaluate(scope)`;
}

function rowAssign(
  source: string,
  context: BindingEmitContext,
  value: string,
  fallbackName: string,
  outerLines: string[]
): string {
  const fast = fastLocalAssign(source, context.localNames, value);
  if (fast) return fast;

  if (!outerLines.some(line => line.includes(`const ${fallbackName} = `))) {
    outerLines.push(`  const ${fallbackName} = ${expressionArg(context, context.expressions.indexOf(source))};`);
  }
  return `${fallbackName}.assign(row.scope, ${value});`;
}

function fastLocalExpression(
  source: string,
  localNames: ReadonlySet<string>,
  localObject = 'scope.locals'
): string | null {
  const trimmed = source.trim();
  if (localNames.has(trimmed)) return propertyAccess(localObject, trimmed);

  const member = /^([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(trimmed);
  if (member && localNames.has(member[1]!)) {
    return `${propertyAccess(localObject, member[1]!)}.${member[2]!}`;
  }

  return null;
}

function propertyAccess(source: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${source}.${key}`
    : `${source}[${JSON.stringify(key)}]`;
}

function fastLocalAssign(source: string, localNames: ReadonlySet<string>, value: string): string | null {
  const trimmed = source.trim();
  if (localNames.has(trimmed)) return `scope.locals[${JSON.stringify(trimmed)}] = ${value};`;

  const member = /^([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(trimmed);
  if (member && localNames.has(member[1]!)) {
    return `(scope.locals[${JSON.stringify(member[1])}])[${JSON.stringify(member[2])}] = ${value};`;
  }

  return null;
}

function stringifyCode(source: string): string {
  return `String((${source}) ?? "")`;
}

function repeatHasSimplePattern(source: string): boolean {
  const [main] = source.split(';', 1);
  const match = /^(.*?)\s+of\s+/.exec(main?.trim() ?? '');
  return !!match && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(match[1]!.trim());
}

function expressionArg(context: BindingEmitContext, expressionId: number, useLocalFastPath = true): string {
  return emitCompiledExpression(
    context.expressions[expressionId]!,
    useLocalFastPath ? { localNames: context.localNames } : {}
  );
}

function templateControllerCall(
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
      if (canEmitOptimizedRepeat(binding, context)) {
        const factory = context.factories.find(entry => entry.id === binding.factoryId)!;
        const factoryContext: BindingEmitContext = {
          expressions: expressionSources(factory),
          factories: factory.factories,
          host: 'view',
          localNames: localNamesForFactory(factory.id, [binding], context.expressions),
          factoryRef: id => context.factoryRef(id)
        };
        return `bindRepeatOptimizedCompiled(${context.host}, ${node}, ${JSON.stringify(context.expressions[binding.expressionId])}, ${context.factoryRef(binding.factoryId!)}_row(${context.host}), ${JSON.stringify(usedRepeatMetaLocals(factory, factoryContext))});`;
      }
      return repeatControllerCall(binding, node, context);
    case 'with':
      return `bindWithCompiled(${context.host}, ${node}, ${JSON.stringify(context.expressions[binding.expressionId])}, ${context.factoryRef(binding.factoryId!)}(${context.host}));`;
    case 'switch':
      return switchControllerCall(binding, node, context);
    case 'promise':
      return promiseControllerCall(binding, node, context);
    default:
      throw new Error(`Template controller "${binding.controller}" is emitted through the runtime-backed DOM module path for now`);
  }
}

function switchControllerCall(
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

function repeatControllerCall(
  binding: Extract<IrBinding, { kind: 'templateController' }>,
  node: string,
  context: BindingEmitContext
): string {
  const factory = context.factories.find(entry => entry.id === binding.factoryId)!;
  const factoryContext: BindingEmitContext = {
    expressions: expressionSources(factory),
    factories: factory.factories,
    host: 'view',
    localNames: localNamesForFactory(factory.id, [binding], context.expressions),
    factoryRef: id => context.factoryRef(id)
  };
  return `bindRepeatCompiled(${context.host}, ${node}, ${JSON.stringify(context.expressions[binding.expressionId])}, ${context.factoryRef(binding.factoryId!)}(${context.host}), ${JSON.stringify(usedRepeatMetaLocals(factory, factoryContext))});`;
}

function promiseControllerCall(
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

function interpolationArg(
  parts: Extract<IrBinding, { kind: 'text' | 'attributeInterpolation' }>['parts'],
  context: BindingEmitContext
): string {
  return `[${parts.map(part => part.type === 'text'
    ? JSON.stringify(part)
    : `{ type: "expression", source: ${expressionArg(context, part.expressionId)} }`).join(', ')}]`;
}

function expressionSources(template: Pick<IrTemplate, 'expressions'> | Pick<IrViewFactory, 'expressions'>): string[] {
  return template.expressions.map(expression => expression.source);
}

function usedRepeatMetaLocals(factory: IrViewFactory, context: BindingEmitContext): string[] {
  const metaNames = new Set(repeatMetaLocalNames());
  const used = new Set<string>();

  for (const binding of factory.bindings) {
    for (const expressionId of bindingExpressionIds(binding)) {
      for (const identifier of collectCompiledExpressionIdentifiers(context.expressions[expressionId]!)) {
        if (metaNames.has(identifier)) used.add(identifier);
      }
    }
  }

  return [...used].sort();
}

function bindingExpressionIds(binding: IrBinding): number[] {
  switch (binding.kind) {
    case 'text':
    case 'attributeInterpolation':
      return binding.parts
        .filter(part => part.type === 'expression')
        .map(part => part.expressionId);
    case 'class':
    case 'event':
    case 'let':
    case 'property':
    case 'show':
    case 'spread':
    case 'style':
      return [binding.expressionId];
    case 'templateController':
      return [binding.expressionId];
    case 'ref':
      return [];
  }
}

function collectRootCustomElementPaths(source: string): number[][] {
  const ast = parseTemplateAst(source);
  return sortCustomElementPaths(collectChildrenCustomElementPaths(ast.root.children, []));
}

function collectCustomElementPaths(node: AstNode): number[][] {
  const paths: number[][] = [];
  collectStaticNodeCustomElementPaths(node, [0], paths);
  return sortCustomElementPaths(paths);
}

function collectChildrenCustomElementPaths(
  nodes: AstNode[],
  parentPath: number[]
): number[][] {
  const consumedElseNodes = new Set<number>();
  const paths: number[][] = [];
  let domIndex = 0;

  for (let index = 0; index < nodes.length; index++) {
    if (consumedElseNodes.has(index)) {
      domIndex++;
      continue;
    }

    const node = nodes[index]!;
    if (isIgnorableAstWhitespace(node)) continue;

    const elseNode = isIfAstElement(node)
      ? nextElseAstNode(nodes, index)
      : null;
    if (elseNode) consumedElseNodes.add(elseNode.index);

    collectStaticNodeCustomElementPaths(node, [...parentPath, domIndex], paths);
    domIndex++;
  }

  return paths;
}

function collectStaticNodeCustomElementPaths(
  node: AstNode,
  path: number[],
  paths: number[][]
): void {
  if (node.kind !== 'element') return;
  if (hasTemplateControllerAttr(node)) return;

  if (isCustomElementCandidate(node)) {
    paths.push(path);
  }

  paths.push(...collectChildrenCustomElementPaths(node.children, path));
}

function hasCustomElementCandidate(node: AstNode): boolean {
  if (node.kind !== 'element') return false;
  if (isCustomElementCandidate(node)) return true;
  return node.children.some(hasCustomElementCandidate);
}

function isCustomElementCandidate(node: AstElement): boolean {
  return node.tagName.includes('-');
}

function hasTemplateControllerAttr(node: AstElement): boolean {
  return node.attrs.some(attr => (
    attr.name === 'if.bind' ||
    attr.name === 'repeat.for' ||
    attr.name === 'with.bind' ||
    attr.name === 'switch.bind' ||
    attr.name === 'promise.bind'
  ));
}

function sortCustomElementPaths(paths: number[][]): number[][] {
  return paths.sort((left, right) => left.length - right.length || comparePath(left, right));
}

function comparePath(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const delta = left[index]! - right[index]!;
    if (delta !== 0) return delta;
  }
  return left.length - right.length;
}

function isIfAstElement(node: AstNode): node is AstElement {
  return node.kind === 'element' && node.attrs.some(attr => attr.name === 'if.bind');
}

function nextElseAstNode(nodes: AstNode[], index: number): { index: number; node: AstElement } | null {
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

function nodePaths(bindings: IrBinding[], extraPaths: number[][] = []): Array<{ name: string; path: number[] }> {
  const paths = new Map<string, number[]>();
  for (const binding of bindings) {
    paths.set(binding.path.join('.'), binding.path);
  }
  for (const path of extraPaths) {
    paths.set(path.join('.'), path);
  }
  return [...paths.values()].map(path => ({ name: nodeName(path), path }));
}

function optimizedRowNodePaths(bindings: IrBinding[]): Array<{ name: string; path: number[] }> {
  return nodePaths(bindings);
}

function countClassBindingsByPath(bindings: IrBinding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const binding of bindings) {
    if (binding.kind !== 'class') continue;
    const key = binding.path.join('.');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function simpleClassNameFastPath(
  factory: IrViewFactory,
  binding: Extract<IrBinding, { kind: 'class' }>,
  classBindingsByPath: ReadonlyMap<string, number>
): string | null {
  if (binding.tokens.length !== 1) return null;
  if (classBindingsByPath.get(binding.path.join('.')) !== 1) return null;

  const element = astElementAtPath(factory.ast, binding.path);
  if (!element) return null;

  const staticClass = element.attrs.find(attr => attr.name === 'class')?.value ?? '';
  if (staticClass.trim() !== '') return null;
  return binding.tokens[0]!;
}

function simpleCheckedFastPath(
  factory: IrViewFactory,
  binding: Extract<IrBinding, { kind: 'property' }>
): boolean {
  if (binding.target !== 'checked') return false;
  const element = astElementAtPath(factory.ast, binding.path);
  return !!element && !element.attrs.some(attr => attr.name === 'checked');
}

function astElementAtPath(root: AstNode, path: number[]): AstElement | null {
  if (root.kind !== 'element' || path[0] !== 0) return null;

  let current: AstNode = root;
  for (let index = 1; index < path.length; index++) {
    if (current.kind !== 'element') return null;
    const child = astChildAtDomIndex(current, path[index]!);
    if (!child) return null;
    current = child;
  }

  return current.kind === 'element' ? current : null;
}

function astChildAtDomIndex(element: AstElement, targetIndex: number): AstNode | null {
  let domIndex = 0;
  for (const child of element.children) {
    if (isIgnorableAstWhitespace(child)) continue;
    if (domIndex === targetIndex) return child;
    domIndex++;
  }
  return null;
}

function isIgnorableAstWhitespace(node: AstNode): boolean {
  return node.kind === 'text' &&
    node.value.includes('\n') &&
    /^\s*$/.test(node.value);
}

function domPathExpression(root: string, path: number[]): string {
  return path.reduce((expression, index) => `${expression}.childNodes[${index}]`, root);
}

function nodeName(path: number[]): string {
  return `node_${path.length ? path.join('_') : 'root'}`;
}

function factoryName(path: number[]): string {
  return `factory_${path.join('_')}`;
}

function canEmitFactory(factory: IrViewFactory): boolean {
  return canEmitBindings(factory.bindings) && factory.factories.every(canEmitFactory);
}

function canEmitBindings(bindings: IrBinding[]): boolean {
  return bindings.every(binding => {
    if (binding.kind !== 'templateController') return true;
    return binding.controller === 'if' ||
      binding.controller === 'repeat' ||
      binding.controller === 'with' ||
      binding.controller === 'switch' ||
      binding.controller === 'promise';
  });
}

function localNamesForFactory(factoryId: number, bindings: IrBinding[], expressions: string[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const binding of bindings) {
    if (binding.kind !== 'templateController') continue;

    if (binding.controller === 'repeat' && binding.factoryId === factoryId) {
      for (const name of repeatLocalNames(expressions[binding.expressionId] ?? '')) {
        names.add(name);
      }
      continue;
    }

    if (binding.controller === 'promise' && binding.promise) {
      if (binding.promise.then?.factoryId === factoryId) names.add(binding.promise.then.local);
      if (binding.promise.catch?.factoryId === factoryId) names.add(binding.promise.catch.local);
    }
  }
  return names;
}

function repeatLocalNames(source: string): string[] {
  const [main] = source.split(';', 1);
  const match = /^(.*?)\s+of\s+/.exec(main?.trim() ?? '');
  if (!match) return repeatMetaLocalNames();

  return [
    ...patternLocalNames(match[1]!.trim()),
    ...repeatMetaLocalNames()
  ];
}

function patternLocalNames(pattern: string): string[] {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(pattern)) return [pattern];
  if (pattern.startsWith('[') && pattern.endsWith(']')) {
    return pattern.slice(1, -1).split(',').map(name => name.trim()).filter(Boolean);
  }
  if (pattern.startsWith('{') && pattern.endsWith('}')) {
    return pattern.slice(1, -1).split(',').map(name => name.trim()).filter(Boolean);
  }
  return [];
}

function repeatMetaLocalNames(): string[] {
  return ['$index', '$first', '$last', '$middle', '$even', '$odd', '$length', '$previous'];
}

function isLifecycleEventName(eventName: string): boolean {
  return eventName === 'attached' || eventName === 'detaching';
}
