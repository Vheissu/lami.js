import type { ExpressionNode } from '../expression/ast.js';
import type { Binding, BindingMode } from '../binding/binding.js';
import { normalizeResourceName } from '../util/casing.js';
import type { Scope } from '../expression/scope.js';

export interface ValueConverter<TIn = unknown, TOut = unknown> {
  toView(value: TIn, ...args: unknown[]): TOut;
  fromView?(value: TOut, ...args: unknown[]): TIn;
}

export type ToViewUpdate = () => void;
export type FromViewUpdate = (value: unknown) => void;
export type EventCallback = (event: Event) => void;

export interface BindingBehaviorFactory {
  create(args: ExpressionNode[]): BindingBehavior;
}

export interface BindingBehavior {
  bind?(binding: Binding, scope: Scope): void;
  wrapToView?(next: ToViewUpdate, scope: Scope): ToViewUpdate;
  wrapFromView?(next: FromViewUpdate, scope: Scope): FromViewUpdate;
  wrapEvent?(next: EventCallback, scope: Scope): EventCallback;
  updateEvents?(scope: Scope): string[];
  mode?: BindingMode;
  forceAttribute?: boolean;
  unbind?(binding: Binding): void;
}

export interface BindableDefinition {
  property?: string;
  mode?: BindingMode;
  set?: (value: unknown) => unknown;
}

export interface AttributeDefinition<TInstance = unknown> {
  name: string;
  Type: new (host: Element, controller: unknown) => TInstance;
  bindables?: Record<string, BindableDefinition>;
  defaultProperty?: string;
  aliases?: string[];
  emptyAsTrue?: boolean;
}

export interface ElementDefinition<TInstance = unknown> {
  name: string;
  Type: new () => TInstance;
  template: string | HTMLTemplateElement;
  bindables?: Record<string, BindableDefinition>;
  shadow?: false | 'open';
}

export type ScopeFactory = (parent: Scope) => object;
export type ScopeResource = object | ScopeFactory;

export interface ResourceRegistryInit {
  converters?: Record<string, ValueConverter>;
  behaviors?: Record<string, BindingBehaviorFactory>;
  attributes?: Record<string, AttributeDefinition>;
  elements?: Record<string, ElementDefinition>;
  scopes?: Record<string, ScopeResource>;
}

export class ResourceRegistry {
  readonly converters = new Map<string, ValueConverter>();
  readonly behaviors = new Map<string, BindingBehaviorFactory>();
  readonly attributes = new Map<string, AttributeDefinition>();
  readonly elements = new Map<string, ElementDefinition>();
  readonly scopes = new Map<string, ScopeResource>();

  constructor(parent?: ResourceRegistry | ResourceRegistryInit) {
    if (parent instanceof ResourceRegistry) {
      for (const [key, value] of parent.converters) this.converters.set(key, value);
      for (const [key, value] of parent.behaviors) this.behaviors.set(key, value);
      for (const [key, value] of parent.attributes) this.attributes.set(key, value);
      for (const [key, value] of parent.elements) this.elements.set(key, value);
      for (const [key, value] of parent.scopes) this.scopes.set(key, value);
    } else if (parent) {
      for (const [key, value] of Object.entries(parent.converters ?? {})) this.registerConverter(key, value);
      for (const [key, value] of Object.entries(parent.behaviors ?? {})) this.registerBehavior(key, value);
      for (const [key, value] of Object.entries(parent.attributes ?? {})) this.registerAttribute(key, value);
      for (const [key, value] of Object.entries(parent.elements ?? {})) this.defineElement(key, value);
      for (const [key, value] of Object.entries(parent.scopes ?? {})) this.registerScope(key, value);
    }
  }

  registerConverter(name: string, converter: ValueConverter): void {
    this.converters.set(normalizeResourceName(name), converter);
  }

  getConverter(name: string): ValueConverter | undefined {
    return this.converters.get(normalizeResourceName(name));
  }

  registerBehavior(name: string, behavior: BindingBehaviorFactory): void {
    this.behaviors.set(normalizeResourceName(name), behavior);
  }

  getBehavior(name: string): BindingBehaviorFactory | undefined {
    return this.behaviors.get(normalizeResourceName(name));
  }

  registerAttribute(name: string, definition: AttributeDefinition): void {
    const normalized = normalizeResourceName(name);
    this.attributes.set(normalized, definition);
    this.attributes.set(normalizeResourceName(definition.name), definition);
    for (const alias of definition.aliases ?? []) {
      this.attributes.set(normalizeResourceName(alias), definition);
    }
  }

  getAttribute(name: string): AttributeDefinition | undefined {
    return this.attributes.get(normalizeResourceName(name));
  }

  defineElement(name: string, definition: ElementDefinition): void {
    const normalized = normalizeResourceName(name);
    this.elements.set(normalized, definition);
    this.elements.set(normalizeResourceName(definition.name), definition);
  }

  getElement(name: string): ElementDefinition | undefined {
    return this.elements.get(normalizeResourceName(name));
  }

  registerScope(name: string, scope: ScopeResource): void {
    this.scopes.set(normalizeResourceName(name), scope);
  }

  getScope(name: string): ScopeResource | undefined {
    return this.scopes.get(normalizeResourceName(name));
  }
}

export const globalResources = new ResourceRegistry();

export function createResourceRegistry(resources?: ResourceRegistry | ResourceRegistryInit): ResourceRegistry {
  const registry = new ResourceRegistry(globalResources);
  if (resources instanceof ResourceRegistry) {
    return mergeRegistries(registry, resources);
  }
  if (resources) {
    const local = new ResourceRegistry(resources);
    return mergeRegistries(registry, local);
  }
  return registry;
}

export function registerConverter(name: string, converter: ValueConverter): void {
  globalResources.registerConverter(name, converter);
}

export function registerBehavior(name: string, behavior: BindingBehaviorFactory): void {
  globalResources.registerBehavior(name, behavior);
}

export function registerAttribute(name: string, definition: AttributeDefinition): void {
  globalResources.registerAttribute(name, definition);
}

export function defineElement(name: string, definition: ElementDefinition): void {
  globalResources.defineElement(name, definition);
}

export function registerScope(name: string, scope: ScopeResource): void {
  globalResources.registerScope(name, scope);
}

function mergeRegistries(first: ResourceRegistry, second: ResourceRegistry): ResourceRegistry {
  const merged = new ResourceRegistry(first);
  for (const key of ['converters', 'behaviors', 'attributes', 'elements', 'scopes'] as const) {
    const source = second[key] as Map<string, unknown>;
    const target = merged[key] as Map<string, unknown>;
    for (const [name, value] of source) target.set(name, value);
  }
  return merged;
}
