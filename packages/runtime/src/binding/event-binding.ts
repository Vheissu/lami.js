import type { Expression } from '../expression/ast.js';
import type { Scope } from '../expression/scope.js';
import type { AttributeSyntax } from '../compiler-runtime/attributes.js';
import type { BindingBehavior } from '../resources/registry.js';
import { BindingController, BindingMode } from './binding.js';
import { bindBehaviors, unbindBehaviors, wrapEvent } from './behaviors.js';

export class EventBinding extends BindingController {
  constructor(
    id: number,
    private readonly element: Element,
    private readonly syntax: AttributeSyntax,
    private readonly expression: Expression,
    private readonly scope: Scope,
    private readonly behaviors: BindingBehavior[] = []
  ) {
    super(id, BindingMode.toView);
  }

  bind(): void {
    bindBehaviors(this.behaviors, this, this.scope);
    const capture = this.syntax.command === 'capture';
    const callback = wrapEvent(this.behaviors, event => this.handleEvent(event), this.scope);

    if (!capture && isLifecycleEvent(this.syntax.target)) {
      if (this.syntax.target === 'attached') {
        callback(createLifecycleEvent(this.syntax.target, this.element));
      } else {
        this.onDispose(() => callback(createLifecycleEvent(this.syntax.target, this.element)));
      }
      return;
    }

    if (canDelegate(this.element, this.syntax.target, capture, this.syntax.modifiers)) {
      this.onDispose(addDelegatedListener(this.element, this.syntax.target, callback));
      return;
    }

    this.element.addEventListener(this.syntax.target, callback, { capture });

    this.onDispose(() => {
      this.element.removeEventListener(this.syntax.target, callback, { capture });
    });
  }

  refresh(): void {}

  override unbind(): void {
    unbindBehaviors(this.behaviors, this);
    super.unbind();
  }

  private handleEvent(event: Event): void {
    if (!eventMatchesModifiers(event, this.syntax.modifiers)) return;

    if (this.syntax.modifiers.includes('prevent')) event.preventDefault();
    if (this.syntax.modifiers.includes('stop')) event.stopPropagation();

    this.runWithDiagnostics(
      'event',
      () => {
        this.expression.evaluate(this.scope.withLocal('$event', event));
      },
      {
        event: event.type,
        expression: this.expression.source,
        target: describeElement(this.element)
      }
    );
  }
}

function isLifecycleEvent(eventName: string): boolean {
  return eventName === 'attached' || eventName === 'detaching';
}

function createLifecycleEvent(eventName: string, element: Element): Event {
  return new CustomEvent(eventName, {
    bubbles: false,
    cancelable: false,
    detail: { element }
  });
}

type DelegatedCallback = (event: Event) => void;
type OptimizedDelegatedElement = Element & {
  [optimizedDelegatedHandlers]?: Record<string, DelegatedCallback | DelegatedCallback[] | undefined>;
};

const delegatedEvents = new Set([
  'click',
  'dblclick',
  'input',
  'change',
  'submit',
  'keydown',
  'keyup',
  'pointerdown',
  'pointerup',
  'pointermove',
  'mousedown',
  'mouseup',
  'mouseover',
  'mouseout'
]);
const delegatedDocuments = new WeakMap<Document, Map<string, { count: number; listener: EventListener }>>();
const delegatedHandlers = new WeakMap<Element, Map<string, Set<DelegatedCallback>>>();
const optimizedDelegatedHandlers = Symbol('lami.optimizedDelegatedHandlers');

function canDelegate(element: Element, eventName: string, capture: boolean, modifiers: string[]): boolean {
  return element.isConnected && !capture && modifiers.length === 0 && delegatedEvents.has(eventName);
}

export function addDelegatedListener(element: Element, eventName: string, callback: DelegatedCallback): () => void {
  let events = delegatedHandlers.get(element);
  if (!events) {
    events = new Map();
    delegatedHandlers.set(element, events);
  }

  let callbacks = events.get(eventName);
  if (!callbacks) {
    callbacks = new Set();
    events.set(eventName, callbacks);
  }
  callbacks.add(callback);

  const document = element.ownerDocument;
  const listener = ensureDocumentDelegatedListener(document, eventName);
  listener.count++;

  return () => {
    callbacks.delete(callback);
    if (callbacks.size === 0) events.delete(eventName);
    if (events.size === 0) delegatedHandlers.delete(element);

    listener.count--;
    if (listener.count === 0) {
      document.removeEventListener(eventName, listener.listener);
      delegatedDocuments.get(document)?.delete(eventName);
    }
  };
}

export function addOptimizedEventListener(element: Element, eventName: string, callback: DelegatedCallback): () => void {
  if (element.isConnected && delegatedEvents.has(eventName)) {
    const target = element as OptimizedDelegatedElement;
    const handlers = target[optimizedDelegatedHandlers] ??= Object.create(null) as Record<string, DelegatedCallback | DelegatedCallback[] | undefined>;
    const current = handlers[eventName];

    if (!current) {
      handlers[eventName] = callback;
    } else if (Array.isArray(current)) {
      current.push(callback);
    } else {
      handlers[eventName] = [current, callback];
    }

    const listener = ensureDocumentDelegatedListener(element.ownerDocument, eventName);
    listener.count++;

    return () => {
      const current = handlers[eventName];
      if (Array.isArray(current)) {
        const index = current.indexOf(callback);
        if (index >= 0) current.splice(index, 1);
        if (current.length === 1) {
          handlers[eventName] = current[0];
        } else if (current.length === 0) {
          delete handlers[eventName];
        }
      } else if (current === callback) {
        delete handlers[eventName];
      }

      listener.count--;
      if (listener.count === 0) {
        element.ownerDocument.removeEventListener(eventName, listener.listener);
        delegatedDocuments.get(element.ownerDocument)?.delete(eventName);
      }
    };
  }

  element.addEventListener(eventName, callback);
  return () => {
    element.removeEventListener(eventName, callback);
  };
}

function ensureDocumentDelegatedListener(
  document: Document,
  eventName: string
): { count: number; listener: EventListener } {
  let events = delegatedDocuments.get(document);
  if (!events) {
    events = new Map();
    delegatedDocuments.set(document, events);
  }

  const existing = events.get(eventName);
  if (existing) return existing;

  const entry = {
    count: 0,
    listener: (event: Event) => dispatchDelegatedEvent(event, eventName)
  };
  events.set(eventName, entry);
  document.addEventListener(eventName, entry.listener);
  return entry;
}

function dispatchDelegatedEvent(event: Event, eventName: string): void {
  let node = event.target instanceof Element
    ? event.target
    : event.target instanceof Node
      ? event.target.parentElement
      : null;

  while (node) {
    const optimizedCallbacks = (node as OptimizedDelegatedElement)[optimizedDelegatedHandlers]?.[eventName];
    if (Array.isArray(optimizedCallbacks)) {
      for (const callback of [...optimizedCallbacks]) {
        callback(event);
        if (event.cancelBubble) return;
      }
    } else if (optimizedCallbacks) {
      optimizedCallbacks(event);
      if (event.cancelBubble) return;
    }

    const callbacks = delegatedHandlers.get(node)?.get(eventName);
    if (callbacks) {
      for (const callback of [...callbacks]) {
        callback(event);
        if (event.cancelBubble) return;
      }
    }
    node = node.parentElement;
  }
}

function describeElement(element: Element): string {
  const id = element.id ? `#${element.id}` : '';
  const classes = element.className && typeof element.className === 'string'
    ? `.${element.className.trim().split(/\s+/).filter(Boolean).join('.')}`
    : '';
  return `${element.tagName.toLowerCase()}${id}${classes}`;
}

export function eventMatchesModifiers(event: Event, modifiers: string[]): boolean {
  for (const modifier of modifiers) {
    switch (modifier) {
      case 'prevent':
      case 'stop':
        continue;
      case 'ctrl':
        if (!('ctrlKey' in event) || !event.ctrlKey) return false;
        continue;
      case 'alt':
        if (!('altKey' in event) || !event.altKey) return false;
        continue;
      case 'shift':
        if (!('shiftKey' in event) || !event.shiftKey) return false;
        continue;
      case 'meta':
        if (!('metaKey' in event) || !event.metaKey) return false;
        continue;
      case 'left':
        if (!('button' in event) || event.button !== 0) return false;
        continue;
      case 'middle':
        if (!('button' in event) || event.button !== 1) return false;
        continue;
      case 'right':
        if (!('button' in event) || event.button !== 2) return false;
        continue;
      default:
        if ('key' in event && typeof event.key === 'string') {
          if (event.key.toLowerCase() !== modifier.toLowerCase()) return false;
        }
    }
  }

  return true;
}
