export { createApp, enhance, type AppHandle, type EnhanceOptions } from './app.js';

export {
  BindingController,
  BindingMode,
  isDefaultTwoWayTarget,
  resolveMode,
  type Binding
} from './binding/binding.js';
export { signal } from './binding/behaviors.js';
export {
  createTargetObserver,
  getElementModel,
  setElementModel,
  writeAttribute,
  writeProperty,
  type TargetObserver,
  type TargetObserverOptions
} from './binding/target-observer.js';

export { parseAttributeSyntax, parseCustomAttributeOptions, type AttributeSyntax, type BindingCommandName } from './compiler-runtime/attributes.js';
export { hasInterpolation, parseInterpolation, type InterpolationPart } from './compiler-runtime/interpolation.js';

export {
  parseExpression,
  evaluateNode,
  assignToNode,
  collectBehaviorCalls,
  hasAssignment,
  unwrapBehaviors
} from './expression/evaluator.js';
export { Scope, getGlobal, getIdentifier, registerGlobal, setIdentifier } from './expression/scope.js';
export type {
  BehaviorCall,
  DependencyDescriptor,
  Expression,
  ExpressionNode,
  ExpressionOptions
} from './expression/ast.js';

export { computed, type ComputedRef } from './reactivity/computed.js';
export { effect, ITERATE_KEY, ReactiveEffect, track, trigger, type Cleanup, type EffectFn, type EffectHandle, type EffectOptions } from './reactivity/effect.js';
export { batch, defaultScheduler, flushJobs, queueJob, type Scheduler } from './reactivity/scheduler.js';
export { markRaw, raw, reactive, readonly } from './reactivity/reactive.js';
export { watch, type WatchCallback, type WatchOptions, type WatchSource } from './reactivity/watch.js';

export {
  ResourceRegistry,
  createResourceRegistry,
  defineElement,
  globalResources,
  registerAttribute,
  registerBehavior,
  registerConverter,
  registerScope,
  type AttributeDefinition,
  type BindableDefinition,
  type BindingBehavior,
  type BindingBehaviorFactory,
  type ElementDefinition,
  type ResourceRegistryInit,
  type ScopeFactory,
  type ScopeResource,
  type ValueConverter
} from './resources/registry.js';

export { LamiError, LamiWarning, type ErrorReporter, type LamiErrorCode, type LamiWarningCode } from './util/errors.js';
