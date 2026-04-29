import { compileAndBindRoot, type RuntimeView } from './compiler-runtime/dom-walker.js';
import { Scope } from './expression/scope.js';
import { reactive } from './reactivity/reactive.js';
import { flushJobs, type Scheduler } from './reactivity/scheduler.js';
import {
  createResourceRegistry,
  type ResourceRegistry,
  type ResourceRegistryInit,
  type ScopeResource
} from './resources/registry.js';
import { registerBuiltInBehaviors } from './binding/behaviors.js';
import type { LamiError, LamiWarning } from './util/errors.js';

export interface EnhanceOptions {
  resources?: ResourceRegistry | ResourceRegistryInit;
  autoDispose?: boolean;
  observeMutations?: boolean;
  scheduler?: Scheduler;
  dev?: boolean;
  onError?: (error: LamiError) => void;
  onWarn?: (warning: LamiWarning) => void;
}

export interface AppHandle {
  root: Element | DocumentFragment;
  scope: Scope;
  dispose(): void;
  flush(): Promise<void>;
}

export function enhance<T extends object>(
  root: Element | DocumentFragment,
  model: T,
  options: EnhanceOptions = {}
): AppHandle {
  const resources = createResourceRegistry(options.resources);
  registerBuiltInBehaviors(resources);

  const reactiveModel = reactive(model);
  const scope = new Scope(reactiveModel);
  const view = compileAndBindRoot(root, scope, resources, {
    ...diagnosticOptions(options)
  });

  const mutationObserver = options.observeMutations && root instanceof Element
    ? observeInsertedIslands(root, scope, resources, options)
    : undefined;
  let disposed = false;
  let autoDisposeObserver: MutationObserver | undefined;

  const handle: AppHandle = {
    root,
    scope,
    dispose() {
      if (disposed) return;
      disposed = true;
      autoDisposeObserver?.disconnect();
      mutationObserver?.dispose();
      view.dispose();
    },
    flush() {
      return options.scheduler?.flush() ?? flushJobs();
    }
  };

  autoDisposeObserver = options.autoDispose && root instanceof Element
    ? autoDisposeWhenRemoved(root, () => handle.dispose())
    : undefined;

  return handle;
}

export function createApp<T extends object>(model: T, options: EnhanceOptions = {}) {
  return {
    mount(root: string | Element | DocumentFragment): AppHandle {
      const target = typeof root === 'string'
        ? document.querySelector(root)
        : root;

      if (!target) {
        throw new Error(`Mount target "${root}" was not found`);
      }

      return enhance(target, model, options);
    }
  };
}

function observeInsertedIslands(
  root: Element,
  scope: Scope,
  resources: ResourceRegistry,
  options: EnhanceOptions
): { dispose(): void } {
  const views = new Map<Element, RuntimeView>();
  const enhanced = new WeakSet<Element>();
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof Element)) continue;
        const islands = node.matches(scopeSelector)
          ? [node]
          : Array.from(node.querySelectorAll(scopeSelector));

        for (const island of islands) {
          if (enhanced.has(island)) continue;
          enhanced.add(island);

          const islandScope = createIslandScope(island, scope, resources);
          const view = compileAndBindRoot(island, islandScope, resources, {
            ...diagnosticOptions(options)
          });
          views.set(island, view);
        }
      }

      for (const node of Array.from(record.removedNodes)) {
        disposeRemovedIslands(node, views);
      }
    }
  });

  observer.observe(root, { childList: true, subtree: true });
  return {
    dispose() {
      observer.disconnect();
      for (const view of views.values()) view.dispose();
      views.clear();
    }
  };
}

function diagnosticOptions(options: EnhanceOptions): Pick<EnhanceOptions, 'dev' | 'onError' | 'onWarn'> {
  return {
    ...(options.dev === undefined ? {} : { dev: options.dev }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.onWarn === undefined ? {} : { onWarn: options.onWarn })
  };
}

function autoDisposeWhenRemoved(root: Element, dispose: () => void): MutationObserver | undefined {
  const parent = root.parentNode;
  if (!parent) return;

  const observer = new MutationObserver(() => {
    if (root.isConnected) return;
    observer.disconnect();
    dispose();
  });
  observer.observe(parent, { childList: true });
  return observer;
}

function createIslandScope(
  island: Element,
  parentScope: Scope,
  resources: ResourceRegistry
): Scope {
  const name = islandScopeName(island);
  if (!name) return parentScope;

  const resource = resources.getScope(name);
  if (!resource) return parentScope;

  const context = createScopeContext(resource, parentScope);
  return parentScope.withContext(reactive(context));
}

function createScopeContext(resource: ScopeResource, parentScope: Scope): object {
  return typeof resource === 'function'
    ? resource(parentScope)
    : resource;
}

function islandScopeName(island: Element): string {
  return island.getAttribute('data-lami-scope') ??
    island.getAttribute('lami-scope') ??
    island.getAttribute('data-au-scope') ??
    island.getAttribute('au-scope') ??
    '';
}

function disposeRemovedIslands(node: Node, views: Map<Element, RuntimeView>): void {
  if (!(node instanceof Element)) return;

  const islands = node.matches(scopeSelector)
    ? [node]
    : Array.from(node.querySelectorAll(scopeSelector));

  for (const island of islands) {
    const view = views.get(island);
    if (!view) continue;
    view.dispose();
    views.delete(island);
  }
}

const scopeSelector = '[au-scope], [data-au-scope], [lami-scope], [data-lami-scope]';
