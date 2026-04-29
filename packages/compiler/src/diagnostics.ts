import type { IrBinding, IrTemplate, IrViewFactory } from './ir.js';
import type { AstNode, SourceLocation } from './ast.js';
import { canEmitDirectDom } from './codegen-dom.js';
import { canEmitDirectHydrate } from './codegen-hydrate.js';
import { canEmitDirectSsr } from './codegen-ssr.js';
import {
  canEmitCompiledExpression,
  canAssignCompiledExpression
} from './codegen-expression.js';
import type { CompileOptions, CompileWarning } from './compile-template.js';

export type CompileDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface CompileDiagnostic {
  code: string;
  severity: CompileDiagnosticSeverity;
  title: string;
  message: string;
  path?: number[];
  loc?: SourceLocation;
  source?: string;
  hint?: string;
}

export function createCompileDiagnostics(
  ir: IrTemplate,
  options: CompileOptions,
  source: string
): { warnings: CompileWarning[]; diagnostics: CompileDiagnostic[] } {
  const diagnostics: CompileDiagnostic[] = [];
  const direct = canEmitModeDirectly(ir, options.mode);

  if (!direct) {
    diagnostics.push({
      code: 'W_COMPILER_RUNTIME_BACKED',
      severity: 'warning',
      title: 'This template needs the runtime-backed compiler path',
      message: 'Lami can still compile this template, but at least one feature is outside the direct DOM subset.',
      hint: 'Use the diagnostics below to find the feature that prevented straight-line DOM output.'
    });
  } else if (options.dev) {
    diagnostics.push({
      code: 'I_COMPILER_DIRECT_DOM',
      severity: 'info',
      title: 'Direct DOM output selected',
      message: 'The compiler emitted direct DOM operations for this template.',
      hint: 'This is the fastest compiled path.'
    });
  }

  if (options.mode === 'dom') {
    collectFastPathDiagnostics(ir, diagnostics, source);
  }

  return {
    warnings: diagnostics
      .filter(diagnostic => diagnostic.severity === 'warning')
      .map(({ code, message, hint, path, loc, source }) => ({
        code,
        message,
        ...(hint ? { hint } : {}),
        ...(path ? { path } : {}),
        ...(loc ? { loc } : {}),
        ...(source ? { source } : {})
      })),
    diagnostics
  };
}

function canEmitModeDirectly(ir: IrTemplate, mode: CompileOptions['mode']): boolean {
  switch (mode) {
    case 'dom': return canEmitDirectDom(ir);
    case 'hydrate': return canEmitDirectHydrate(ir);
    case 'ssr': return canEmitDirectSsr(ir);
  }
}

function collectFastPathDiagnostics(
  ir: IrTemplate,
  diagnostics: CompileDiagnostic[],
  source: string
): void {
  collectFactoryFastPathDiagnostics(ir.factories, ir.bindings, ir.expressions.map(expression => expression.source), diagnostics, source);
}

function collectFactoryFastPathDiagnostics(
  factories: IrViewFactory[],
  ownerBindings: IrBinding[],
  ownerExpressions: string[],
  diagnostics: CompileDiagnostic[],
  source: string
): void {
  for (const factory of factories) {
    const context = {
      expressions: factory.expressions.map(expression => expression.source),
      localNames: localNamesForFactory(factory.id, ownerBindings, ownerExpressions)
    };

    for (const binding of factory.bindings) {
      const reason = optimizedRowBindingMiss(binding, context);
      if (!reason) continue;
      const loc = locationForPath(factory.ast, binding.path);
      diagnostics.push({
        code: 'I_OPTIMIZED_ROW_MISS',
        severity: 'info',
        title: 'Repeat row uses the generic view path',
        message: reason,
        path: binding.path,
        ...(loc ? { loc, source: sourceExcerpt(source, loc) } : {}),
        hint: 'Rows are fastest when bindings are simple text/class/checked/event/show expressions over repeat locals.'
      });
    }

    collectFactoryFastPathDiagnostics(
      factory.factories,
      factory.bindings,
      context.expressions,
      diagnostics,
      source
    );
  }
}

function optimizedRowBindingMiss(
  binding: IrBinding,
  context: { expressions: string[]; localNames: ReadonlySet<string> }
): string | null {
  switch (binding.kind) {
    case 'text': {
      const unsupported = binding.parts.find(part =>
        part.type === 'expression' &&
        !canEmitCompiledExpression(context.expressions[part.expressionId]!)
      );
      return unsupported
        ? 'A text interpolation uses expression syntax that cannot be emitted as direct JavaScript yet.'
        : null;
    }

    case 'class':
    case 'show':
      return canEmitCompiledExpression(context.expressions[binding.expressionId]!)
        ? null
        : `${binding.kind} binding uses expression syntax that cannot be emitted as direct JavaScript yet.`;

    case 'property': {
      const mode = String(binding.mode);
      if (binding.target !== 'checked') return `Property "${binding.target}" does not have an optimized row writer yet.`;
      if (mode !== 'toView' && mode !== 'twoWay') return `Property mode "${mode}" does not have an optimized row writer yet.`;
      if (!canEmitCompiledExpression(context.expressions[binding.expressionId]!)) return 'The checked binding expression cannot be emitted as direct JavaScript yet.';
      if (mode === 'twoWay' && !canAssignCompiledExpression(context.expressions[binding.expressionId]!)) return 'The checked binding is two-way, but the expression is not assignable.';
      return null;
    }

    case 'event':
      if (binding.capture) return 'Captured events stay on the generic event binding path.';
      if (binding.modifiers.length > 0) return 'Event modifiers stay on the generic event binding path.';
      if (isLifecycleEvent(binding.eventName)) return 'Lifecycle hook events stay on the generic event binding path.';
      return canEmitCompiledExpression(context.expressions[binding.expressionId]!)
        ? null
        : 'The event expression cannot be emitted as direct JavaScript yet.';

    case 'templateController':
      return `Nested "${binding.controller}" controllers inside a repeat row stay on the generic view path for now.`;

    case 'attributeInterpolation':
      return 'Attribute interpolation inside repeat rows stays on the generic view path for now.';
    case 'let':
      return '<let> inside repeat rows stays on the generic view path for now.';
    case 'ref':
      return 'Refs inside repeat rows stay on the generic view path for now.';
    case 'spread':
      return 'Spread bindings inside repeat rows stay on the generic view path for now.';
    case 'style':
      return 'Style bindings inside repeat rows stay on the generic view path for now.';
  }
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

function isLifecycleEvent(eventName: string): boolean {
  return eventName === 'attached' || eventName === 'detaching';
}

function locationForPath(root: AstNode, path: number[]): SourceLocation | undefined {
  if (root.kind !== 'element' || path[0] !== 0) return root.loc;

  let current: AstNode = root;
  for (let index = 1; index < path.length; index++) {
    if (current.kind !== 'element') return current.loc;
    const child = childAtDomIndex(current, path[index]!);
    if (!child) return current.loc;
    current = child;
  }

  return current.loc;
}

function childAtDomIndex(element: Extract<AstNode, { kind: 'element' }>, targetIndex: number): AstNode | undefined {
  let domIndex = 0;
  for (const child of element.children) {
    if (isIgnorableWhitespace(child)) continue;
    if (domIndex === targetIndex) return child;
    domIndex++;
  }
  return undefined;
}

function isIgnorableWhitespace(node: AstNode): boolean {
  return node.kind === 'text' &&
    node.value.includes('\n') &&
    /^\s*$/.test(node.value);
}

function sourceExcerpt(source: string, loc: SourceLocation): string {
  const lines = source.split(/\r?\n/);
  const line = lines[loc.line - 1] ?? '';
  const pointerStart = Math.max(0, loc.column - 1);
  const pointerLength = loc.line === loc.endLine
    ? Math.max(1, loc.endColumn - loc.column)
    : Math.max(1, line.length - pointerStart);
  return `${line}\n${' '.repeat(pointerStart)}${'^'.repeat(pointerLength)}`;
}
