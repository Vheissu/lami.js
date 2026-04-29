import type { Cleanup } from '../util/dom.js';
import { markRaw } from '../reactivity/reactive.js';
import { LamiError } from '../util/errors.js';

export interface TargetObserver<T = unknown> {
  read(): T;
  write(value: T): void;
  subscribe(callback: (value: T) => void): Cleanup;
  readForSource?(currentSourceValue: unknown): unknown;
}

export interface TargetObserverOptions {
  forceAttribute?: boolean;
  updateEvents?: string[];
  dev?: boolean;
}

const elementModels = new WeakMap<Element, unknown>();
const batchedPropertyChanges = new WeakMap<object, {
  changes: Record<string, { newValue: unknown; oldValue: unknown }>;
  pending: boolean;
}>();

export function setElementModel(el: Element, value: unknown): void {
  elementModels.set(el, value);
}

export function getElementModel(el: Element): unknown {
  return elementModels.has(el)
    ? elementModels.get(el)
    : (el as HTMLInputElement | HTMLOptionElement).value;
}

export function createTargetObserver(
  element: Element,
  target: string,
  options: TargetObserverOptions = {}
): TargetObserver {
  if (target === 'model') return new ModelObserver(element);
  if (target === 'focus') return new FocusObserver(element);

  if (options.forceAttribute) {
    return new AttributeObserver(element, target);
  }

  if (element instanceof HTMLInputElement) {
    return createInputObserver(element, target, options);
  }

  if (element instanceof HTMLTextAreaElement) {
    return createTextareaObserver(element, target, options);
  }

  if (element instanceof HTMLSelectElement) {
    return createSelectObserver(element, target, options);
  }

  if (target === 'class') return new ClassObserver(element);
  if (target === 'style') return new StyleObserver(element);
  if (target === 'textContent') return new PropertyObserver(element, target);

  if (isSvg(element) || target.startsWith('aria-') || target.startsWith('data-')) {
    return new AttributeObserver(element, target);
  }

  return target in element
    ? new PropertyObserver(element, target)
    : new AttributeObserver(element, target);
}

export function writeAttribute(el: Element, name: string, value: unknown): void {
  if (value === false || value === null || value === undefined) {
    el.removeAttribute(name);
    return;
  }

  if (value === true) {
    el.setAttribute(name, '');
    return;
  }

  el.setAttribute(name, String(value));
}

export function writeProperty(el: Element, name: string, value: unknown): void {
  if (name in el) {
    (el as unknown as Record<string, unknown>)[name] = value;
    return;
  }

  writeAttribute(el, name, value);
}

export class AttributeObserver implements TargetObserver {
  constructor(
    protected readonly element: Element,
    protected readonly name: string
  ) {}

  read(): unknown {
    return this.element.getAttribute(this.name);
  }

  write(value: unknown): void {
    writeAttribute(this.element, this.name, value);
  }

  subscribe(): Cleanup {
    return () => {};
  }
}

export class PropertyObserver implements TargetObserver {
  constructor(
    protected readonly element: Element,
    protected readonly name: string
  ) {}

  read(): unknown {
    return (this.element as unknown as Record<string, unknown>)[this.name];
  }

  write(value: unknown): void {
    writeProperty(this.element, this.name, value);
  }

  subscribe(callback: (value: unknown) => void): Cleanup {
    const listener = () => callback(this.read());
    this.element.addEventListener('change', listener);
    this.element.addEventListener('input', listener);
    return () => {
      this.element.removeEventListener('change', listener);
      this.element.removeEventListener('input', listener);
    };
  }
}

export class ClassObserver implements TargetObserver {
  private managed = new Set<string>();

  constructor(private readonly element: Element) {}

  read(): string {
    return this.element.getAttribute('class') ?? '';
  }

  write(value: unknown): void {
    for (const className of this.managed) {
      this.element.classList.remove(className);
    }
    this.managed.clear();

    for (const className of normalizeClassValue(value)) {
      this.element.classList.add(className);
      this.managed.add(className);
    }
  }

  subscribe(): Cleanup {
    return () => {};
  }
}

export class TokenClassObserver implements TargetObserver {
  private active = false;

  constructor(
    private readonly element: Element,
    private readonly tokens: string[]
  ) {}

  read(): boolean {
    return this.active;
  }

  write(value: unknown): void {
    this.active = !!value;
    for (const token of this.tokens) {
      this.element.classList.toggle(token, this.active);
    }
  }

  subscribe(): Cleanup {
    return () => {};
  }
}

export class StyleObserver implements TargetObserver {
  private managed = new Set<string>();

  constructor(private readonly element: Element) {}

  read(): string {
    return (this.element as HTMLElement).style.cssText;
  }

  write(value: unknown): void {
    const style = (this.element as HTMLElement).style;
    for (const key of this.managed) {
      style.removeProperty(key);
      (style as unknown as Record<string, string>)[key] = '';
    }
    this.managed.clear();

    if (value == null || value === false) return;

    if (typeof value === 'string') {
      style.cssText = value;
      return;
    }

    if (typeof value !== 'object') return;

    for (const [key, next] of Object.entries(value as Record<string, unknown>)) {
      writeStyleProperty(style, key, next);
      this.managed.add(key);
    }
  }

  subscribe(): Cleanup {
    return () => {};
  }
}

export class StylePropertyObserver implements TargetObserver {
  constructor(
    private readonly element: Element,
    private readonly property: string
  ) {}

  read(): unknown {
    return (this.element as HTMLElement).style.getPropertyValue(this.property);
  }

  write(value: unknown): void {
    writeStyleProperty((this.element as HTMLElement).style, this.property, value);
  }

  subscribe(): Cleanup {
    return () => {};
  }
}

export class ModelObserver implements TargetObserver {
  constructor(private readonly element: Element) {}

  read(): unknown {
    return getElementModel(this.element);
  }

  write(value: unknown): void {
    setElementModel(this.element, value);
  }

  subscribe(): Cleanup {
    return () => {};
  }
}

export class ObjectPropertyObserver implements TargetObserver {
  constructor(
    private readonly object: Record<string, unknown>,
    private readonly property: string,
    private readonly coerce?: (value: unknown) => unknown
  ) {}

  read(): unknown {
    return this.object[this.property];
  }

  write(value: unknown): void {
    const next = this.coerce ? this.coerce(value) : value;
    const oldValue = this.object[this.property];
    if (Object.is(oldValue, next)) return;

    this.object[this.property] = next;
    const changed = this.object[`${this.property}Changed`];
    if (typeof changed === 'function') {
      changed.call(this.object, next, oldValue);
    }

    const propertiesChanged = this.object.propertiesChanged;
    if (typeof propertiesChanged === 'function') {
      queuePropertiesChanged(this.object, this.property, next, oldValue, propertiesChanged);
    }
  }

  subscribe(): Cleanup {
    return () => {};
  }
}

function queuePropertiesChanged(
  object: Record<string, unknown>,
  property: string,
  newValue: unknown,
  oldValue: unknown,
  callback: Function
): void {
  let batch = batchedPropertyChanges.get(object);
  if (!batch) {
    batch = {
      changes: {},
      pending: false
    };
    batchedPropertyChanges.set(object, batch);
  }

  batch.changes[property] = { newValue, oldValue };
  if (batch.pending) return;

  batch.pending = true;
  queueMicrotask(() => {
    const changes = batch.changes;
    batch.changes = {};
    batch.pending = false;
    callback.call(object, changes);
  });
}

export class FocusObserver implements TargetObserver<boolean> {
  constructor(private readonly element: Element) {}

  read(): boolean {
    return this.element.ownerDocument.activeElement === this.element;
  }

  write(value: unknown): void {
    if (value) {
      queueMicrotask(() => {
        if (this.element.ownerDocument.activeElement !== this.element && 'focus' in this.element) {
          (this.element as HTMLElement).focus();
        }
      });
      return;
    }

    if (this.element.ownerDocument.activeElement === this.element && 'blur' in this.element) {
      (this.element as HTMLElement).blur();
    }
  }

  subscribe(callback: (value: boolean) => void): Cleanup {
    const focus = () => callback(true);
    const blur = () => callback(false);
    this.element.addEventListener('focus', focus);
    this.element.addEventListener('blur', blur);
    return () => {
      this.element.removeEventListener('focus', focus);
      this.element.removeEventListener('blur', blur);
    };
  }
}

class InputValueObserver extends PropertyObserver {
  private readonly input: HTMLInputElement;
  private readonly events: string[];

  constructor(element: HTMLInputElement, name: string, options: TargetObserverOptions) {
    super(element, name);
    this.input = element;
    this.events = options.updateEvents ?? defaultInputEvents(element);
  }

  override read(): unknown {
    const value = super.read();
    return this.input.type === 'file' && typeof value === 'object' && value !== null
      ? markRaw(value)
      : value;
  }

  override subscribe(callback: (value: unknown) => void): Cleanup {
    return subscribeEvents(this.element, this.events, () => callback(this.read()));
  }
}

class InputCheckedObserver extends PropertyObserver {
  private readonly input: HTMLInputElement;
  private readonly events: string[];

  constructor(element: HTMLInputElement, options: TargetObserverOptions) {
    super(element, 'checked');
    this.input = element;
    this.events = options.updateEvents ?? ['change'];
  }

  override write(value: unknown): void {
    if (this.input.type === 'checkbox' && Array.isArray(value)) {
      this.input.checked = value.includes(getElementModel(this.input));
      return;
    }

    if (this.input.type === 'radio') {
      this.input.checked = Object.is(value, getElementModel(this.input));
      return;
    }

    this.input.checked = !!value;
  }

  override subscribe(callback: (value: unknown) => void): Cleanup {
    return subscribeEvents(this.input, this.events, () => callback(this.read()));
  }

  readForSource(currentSourceValue: unknown): unknown {
    if (this.input.type === 'checkbox' && Array.isArray(currentSourceValue)) {
      const model = getElementModel(this.input);
      if (this.input.checked) {
        return currentSourceValue.includes(model)
          ? currentSourceValue
          : [...currentSourceValue, model];
      }
      return currentSourceValue.filter(value => value !== model);
    }

    if (this.input.type === 'radio') {
      return this.input.checked ? getElementModel(this.input) : currentSourceValue;
    }

    return this.input.checked;
  }
}

class TextareaValueObserver extends PropertyObserver {
  private readonly events: string[];

  constructor(element: HTMLTextAreaElement, options: TargetObserverOptions) {
    super(element, 'value');
    this.events = options.updateEvents ?? ['input', 'change'];
  }

  override subscribe(callback: (value: unknown) => void): Cleanup {
    return subscribeEvents(this.element, this.events, () => callback(this.read()));
  }
}

class SelectValueObserver extends PropertyObserver {
  private readonly select: HTMLSelectElement;
  private readonly events: string[];

  constructor(element: HTMLSelectElement, options: TargetObserverOptions) {
    super(element, 'value');
    this.select = element;
    this.events = options.updateEvents ?? ['change'];
  }

  override read(): unknown {
    if (this.select.multiple) {
      return Array.from(this.select.selectedOptions, option => getElementModel(option));
    }

    const option = this.select.selectedOptions[0];
    return option ? getElementModel(option) : this.select.value;
  }

  override write(value: unknown): void {
    const values = this.select.multiple && Array.isArray(value) ? value : [value];
    this.applySelection(values);
    queueMicrotask(() => this.applySelection(values));
  }

  private applySelection(values: unknown[]): void {
    for (const option of Array.from(this.select.options)) {
      const model = getElementModel(option);
      option.selected = values.some(item => Object.is(item, model));
    }
  }

  override subscribe(callback: (value: unknown) => void): Cleanup {
    return subscribeEvents(this.select, this.events, () => callback(this.read()));
  }
}

function createInputObserver(element: HTMLInputElement, target: string, options: TargetObserverOptions): TargetObserver {
  if (target === 'checked') return new InputCheckedObserver(element, options);
  if (target === 'files') return new InputValueObserver(element, target, { ...options, updateEvents: options.updateEvents ?? ['change'] });
  if (element.type === 'file' && target === 'value' && options.dev) {
    throw new LamiError('E_BIND_TARGET', 'value.bind is not supported on file inputs; use files.from-view instead');
  }
  if (target === 'value') return new InputValueObserver(element, target, options);
  return target in element ? new PropertyObserver(element, target) : new AttributeObserver(element, target);
}

function createTextareaObserver(element: HTMLTextAreaElement, target: string, options: TargetObserverOptions): TargetObserver {
  if (target === 'value') return new TextareaValueObserver(element, options);
  return target in element ? new PropertyObserver(element, target) : new AttributeObserver(element, target);
}

function createSelectObserver(element: HTMLSelectElement, target: string, options: TargetObserverOptions): TargetObserver {
  if (target === 'value' || target === 'selectedIndex') return new SelectValueObserver(element, options);
  return target in element ? new PropertyObserver(element, target) : new AttributeObserver(element, target);
}

function subscribeEvents(element: Element, events: string[], handler: () => void): Cleanup {
  for (const event of events) {
    element.addEventListener(event, handler);
  }
  return () => {
    for (const event of events) {
      element.removeEventListener(event, handler);
    }
  };
}

function defaultInputEvents(element: HTMLInputElement): string[] {
  switch (element.type) {
    case 'date':
    case 'color':
    case 'range':
    case 'file':
    case 'checkbox':
    case 'radio':
      return ['change'];
    default:
      return ['input', 'change'];
  }
}

function normalizeClassValue(value: unknown): string[] {
  if (value == null || value === false) return [];
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => !!enabled)
      .map(([className]) => className);
  }
  return [String(value)];
}

function writeStyleProperty(style: CSSStyleDeclaration, key: string, value: unknown): void {
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

function isSvg(element: Element): boolean {
  return element.namespaceURI === 'http://www.w3.org/2000/svg';
}
