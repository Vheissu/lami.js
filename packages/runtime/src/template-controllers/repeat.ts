import type { Expression } from '../expression/ast.js';
import { parseExpression } from '../expression/evaluator.js';
import type { Scope } from '../expression/scope.js';
import { BindingController, BindingMode } from '../binding/binding.js';
import { LamiError } from '../util/errors.js';
import { ITERATE_KEY, track } from '../reactivity/effect.js';
import { markRaw, raw, reactive } from '../reactivity/reactive.js';
import type { View, ViewFactory } from './view.js';

export interface RepeatDefinition {
  pattern: string;
  items: string;
  key?: string;
}

export class RepeatController extends BindingController {
  private views: View[] = [];
  private keyedViews = new Map<unknown, View>();
  private readonly simplePatternName: string | null;
  private readonly simpleKeyName: string | null;
  private readonly meta: RepeatMetaUsage;

  constructor(
    id: number,
    private readonly definition: RepeatDefinition,
    private readonly itemsExpression: Expression,
    private readonly keyExpression: Expression | null,
    private readonly scope: Scope,
    private readonly factory: ViewFactory,
    private readonly location: Comment,
    metaLocals: readonly string[] = defaultRepeatMetaLocals
  ) {
    super(id, BindingMode.toView);
    this.simplePatternName = simpleIdentifier(definition.pattern);
    this.simpleKeyName = keyExpression ? simpleIdentifier(keyExpression.source.trim()) : null;
    this.meta = repeatMetaUsage(metaLocals);
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
    for (const view of this.views) {
      view.unbind();
      view.remove();
    }
    this.views = [];
    this.keyedViews.clear();
    super.unbind();
  }

  private refreshIndexed(items: unknown[]): void {
    if (this.views.length === 0) {
      this.mountInitialIndexed(items);
      return;
    }

    for (let index = 0; index < items.length; index++) {
      const item = repeatItem(items[index]);
      const locals = this.createLocals(item, index, items.length, repeatItem(items[index - 1]));
      let view = this.views[index];

      if (!view) {
        view = this.factory.create(this.scope.withLocals(locals));
        this.views[index] = view;
        view.moveBefore(this.location);
        view.bind();
      } else {
        view.updateLocals?.(locals);
        view.refresh();
      }
    }

    while (this.views.length > items.length) {
      const view = this.views.pop()!;
      view.unbind();
      view.remove();
    }
  }

  private refreshKeyed(items: unknown[]): void {
    if (this.views.length === 0) {
      this.mountInitialKeyed(items);
      return;
    }

    const nextViews: View[] = [];
    const nextKeyed = new Map<unknown, View>();
    let reference: Node = this.views[0]?.first ?? this.location;

    for (let index = 0; index < items.length; index++) {
      const item = repeatItem(items[index]);
      const locals = this.createLocals(item, index, items.length, repeatItem(items[index - 1]));
      const itemScope = this.scope.withLocals(locals);
      const key = this.evaluateKey(item, itemScope);
      if (nextKeyed.has(key)) {
        throw new LamiError('E_REPEAT_PARSE', `Duplicate repeat key "${String(key)}"`);
      }
      let view = this.keyedViews.get(key);
      const isNew = !view;

      if (!view) {
        view = this.factory.create(itemScope);
      } else {
        view.updateLocals?.(locals);
        view.refresh();
      }

      if (view.first !== reference) {
        view.moveBefore(reference);
      }
      if (isNew) {
        view.bind();
      }
      reference = view.last.nextSibling ?? this.location;
      nextViews.push(view);
      nextKeyed.set(key, view);
    }

    for (const [key, view] of this.keyedViews) {
      if (nextKeyed.has(key)) continue;
      view.unbind();
      view.remove();
    }

    this.views = nextViews;
    this.keyedViews = nextKeyed;
  }

  private mountInitialIndexed(items: unknown[]): void {
    const views: View[] = [];
    const fragment = this.location.ownerDocument.createDocumentFragment();

    for (let index = 0; index < items.length; index++) {
      const item = repeatItem(items[index]);
      const locals = this.createLocals(item, index, items.length, repeatItem(items[index - 1]));
      const view = this.factory.create(this.scope.withLocals(locals));
      appendView(view, fragment);
      views.push(view);
    }

    if (views.length > 0) {
      this.location.parentNode?.insertBefore(fragment, this.location);
      for (const view of views) view.bind();
    }

    this.views = views;
  }

  private mountInitialKeyed(items: unknown[]): void {
    const views: View[] = [];
    const keyedViews = new Map<unknown, View>();
    const fragment = this.location.ownerDocument.createDocumentFragment();

    for (let index = 0; index < items.length; index++) {
      const item = repeatItem(items[index]);
      const locals = this.createLocals(item, index, items.length, repeatItem(items[index - 1]));
      const itemScope = this.scope.withLocals(locals);
      const key = this.evaluateKey(item, itemScope);
      if (keyedViews.has(key)) {
        throw new LamiError('E_REPEAT_PARSE', `Duplicate repeat key "${String(key)}"`);
      }

      const view = this.factory.create(itemScope);
      appendView(view, fragment);
      views.push(view);
      keyedViews.set(key, view);
    }

    if (views.length > 0) {
      this.location.parentNode?.insertBefore(fragment, this.location);
      for (const view of views) view.bind();
    }

    this.views = views;
    this.keyedViews = keyedViews;
  }

  private evaluateKey(item: unknown, itemScope: Scope): unknown {
    if (
      this.simpleKeyName &&
      item !== null &&
      typeof item === 'object' &&
      Object.prototype.hasOwnProperty.call(item, this.simpleKeyName)
    ) {
      return (item as Record<string, unknown>)[this.simpleKeyName];
    }

    return this.keyExpression!.evaluate(itemScope);
  }

  private createLocals(
    item: unknown,
    index: number,
    length: number,
    previous: unknown
  ): Record<string, unknown> {
    if (!this.simplePatternName) {
      return createRepeatLocals(this.definition.pattern, item, index, length, previous, this.meta);
    }

    const locals: Record<string, unknown> = Object.create(null);
    locals[this.simplePatternName] = item;
    addRepeatMetadata(locals, index, length, previous, this.meta);
    return markRaw(locals);
  }
}

export function parseRepeat(value: string): RepeatDefinition {
  const [main, ...options] = value.split(';').map(part => part.trim()).filter(Boolean);
  if (!main) throw new LamiError('E_REPEAT_PARSE', 'repeat.for requires an item expression');
  const match = /^(.*?)\s+of\s+(.+)$/.exec(main);
  if (!match) throw new LamiError('E_REPEAT_PARSE', `Invalid repeat expression "${value}"`);

  const definition: RepeatDefinition = {
    pattern: match[1]!.trim(),
    items: match[2]!.trim()
  };

  for (const option of options) {
    const [name, expression] = option.split(':', 2).map(part => part.trim());
    if (name === 'key' && expression) {
      definition.key = expression;
    }
  }

  return definition;
}

export function createRepeatController(
  id: number,
  value: string,
  scope: Scope,
  factory: ViewFactory,
  location: Comment,
  options: { resources?: Parameters<typeof parseExpression>[1] } = {}
): RepeatController {
  const definition = parseRepeat(value);
  const expressionOptions = options.resources ?? {};
  return new RepeatController(
    id,
    definition,
    parseExpression(definition.items, expressionOptions),
    definition.key ? parseExpression(definition.key, expressionOptions) : null,
    scope,
    factory,
    location
  );
}

export function createRepeatLocals(
  pattern: string,
  item: unknown,
  index: number,
  length: number,
  previous: unknown,
  meta: RepeatMetaUsage = allRepeatMetaUsage
): Record<string, unknown> {
  const locals = destructurePattern(pattern, item);
  addRepeatMetadata(locals, index, length, previous, meta);
  return markRaw(locals);
}

export function materialize(value: unknown): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    const source = raw(value);
    track(source, ITERATE_KEY);
    return source;
  }
  if (typeof value === 'number') return Array.from({ length: Math.max(0, value) }, (_, index) => index);
  if (value instanceof Map) return Array.from(value.entries());
  if (value instanceof Set) return Array.from(value.values());
  if (typeof value === 'object' && Symbol.iterator in value) return Array.from(value as Iterable<unknown>);
  return [];
}

function repeatItem(item: unknown): unknown {
  return item !== null && typeof item === 'object'
    ? reactive(item)
    : item;
}

function appendView(view: View, parent: Node): void {
  if (view.appendTo) {
    view.appendTo(parent);
    return;
  }

  let cursor: Node | null = view.first;
  const end = view.last.nextSibling;
  while (cursor && cursor !== end) {
    const current = cursor;
    cursor = cursor.nextSibling;
    parent.appendChild(current);
  }
}

function addRepeatMetadata(
  locals: Record<string, unknown>,
  index: number,
  length: number,
  previous: unknown,
  meta: RepeatMetaUsage
): void {
  if (meta.usesIndex) locals.$index = index;
  if (meta.usesFirst) locals.$first = index === 0;
  if (meta.usesLast) locals.$last = index === length - 1;
  if (meta.usesMiddle) locals.$middle = index > 0 && index < length - 1;
  if (meta.usesEven) locals.$even = index % 2 === 0;
  if (meta.usesOdd) locals.$odd = index % 2 === 1;
  if (meta.usesLength) locals.$length = length;
  if (meta.usesPrevious) locals.$previous = previous;
}

interface RepeatMetaUsage {
  usesIndex: boolean;
  usesFirst: boolean;
  usesLast: boolean;
  usesMiddle: boolean;
  usesEven: boolean;
  usesOdd: boolean;
  usesLength: boolean;
  usesPrevious: boolean;
}

const defaultRepeatMetaLocals = ['$index', '$first', '$last', '$middle', '$even', '$odd', '$length', '$previous'];
const allRepeatMetaUsage = repeatMetaUsage(defaultRepeatMetaLocals);

function repeatMetaUsage(metaLocals: readonly string[]): RepeatMetaUsage {
  const meta = new Set(metaLocals);
  return {
    usesIndex: meta.has('$index'),
    usesFirst: meta.has('$first'),
    usesLast: meta.has('$last'),
    usesMiddle: meta.has('$middle'),
    usesEven: meta.has('$even'),
    usesOdd: meta.has('$odd'),
    usesLength: meta.has('$length'),
    usesPrevious: meta.has('$previous')
  };
}

function simpleIdentifier(source: string): string | null {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(source) ? source : null;
}

function destructurePattern(pattern: string, item: unknown): Record<string, unknown> {
  const trimmed = pattern.trim();
  const simple = simpleIdentifier(trimmed);
  if (simple) {
    const locals: Record<string, unknown> = Object.create(null);
    locals[simple] = item;
    return locals;
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const names = trimmed.slice(1, -1).split(',').map(name => name.trim()).filter(Boolean);
    const values = Array.isArray(item) ? item : [];
    return Object.fromEntries(names.map((name, index) => [name, values[index]]));
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const names = trimmed.slice(1, -1).split(',').map(name => name.trim()).filter(Boolean);
    const source = item as Record<string, unknown>;
    return Object.fromEntries(names.map(name => [name, source?.[name]]));
  }

  throw new LamiError('E_REPEAT_PARSE', `Unsupported repeat pattern "${pattern}"`);
}
