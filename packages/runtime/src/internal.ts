export { compileAndBindRoot, createElementViewFactory, DomView } from './compiler-runtime/dom-walker.js';
export { parseExpression } from './expression/evaluator.js';
export { getIdentifier, Scope, setIdentifier } from './expression/scope.js';
export { createResourceRegistry } from './resources/registry.js';
export {
  bindAttributeCompiled,
  bindClassCompiled,
  bindClassOptimizedCompiled,
  bindCustomElementCompiled,
  bindEventCompiled,
  bindIfCompiled,
  bindLetCompiled,
  bindPromiseCompiled,
  bindPropertyCompiled,
  bindPropertyOptimizedCompiled,
  bindRefCompiled,
  bindRepeatCompiled,
  bindRepeatOptimizedCompiled,
  bindShowCompiled,
  bindSpreadCompiled,
  bindStyleCompiled,
  bindSwitchCompiled,
  bindTextCompiled,
  bindTextOptimizedCompiled,
  bindWithCompiled,
  createCompiledApp,
  createCompiledViewFactory,
  createOptimizedRepeatRow,
  createOptimizedRepeatRowFromNodes,
  createTemplate,
  prepareCustomElementCompiled,
  type CompiledApp,
  type CompiledBindingHost,
  type CompiledExpressionDefinition,
  type CompiledExpressionInput,
  type CompiledInterpolationPart,
  type CompiledMountOptions,
  type CompiledPromiseBranches,
  type CompiledSwitchCase,
  type CompiledView,
  type CompiledViewBinder,
  type OptimizedCompiledView,
  type OptimizedRepeatRow,
  type OptimizedRepeatRowFactory
} from './compiler-runtime/compiled.js';
export { EventBinding, addDelegatedListener, addOptimizedEventListener, eventMatchesModifiers } from './binding/event-binding.js';
export { InterpolationBinding, PropertyBinding } from './binding/property-binding.js';
export { RefBinding } from './binding/ref-binding.js';
export { SpreadBinding } from './binding/spread-binding.js';
export { IfController } from './template-controllers/if.js';
export { LetBinding } from './template-controllers/let.js';
export { PromiseController } from './template-controllers/promise.js';
export { createRepeatLocals, materialize, parseRepeat, RepeatController } from './template-controllers/repeat.js';
export { ShowController } from './template-controllers/show.js';
export { SwitchController } from './template-controllers/switch.js';
export { WithController } from './template-controllers/with.js';
export type { RuntimeView } from './compiler-runtime/dom-walker.js';
export type { View, ViewFactory } from './template-controllers/view.js';
export { path, parseTemplate } from './util/dom.js';
