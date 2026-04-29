export {
  compileTemplate,
  type CompileOptions,
  type CompileResult,
  type CompileWarning,
  type TemplateMetadata
} from './compile-template.js';
export type {
  CompileDiagnostic,
  CompileDiagnosticSeverity
} from './diagnostics.js';
export { parseTemplateAst } from './parse-html.js';
export { astToIr, compileToIr } from './ir.js';
export type {
  AstAttribute,
  AstComment,
  AstElement,
  AstFragment,
  AstNode,
  AstText,
  ImportDeclaration,
  TemplateAst
} from './ast.js';
export type {
  IrAttributeInterpolationBinding,
  IrBinding,
  IrEventBinding,
  IrExpression,
  IrInterpolationPart,
  IrPropertyBinding,
  IrRefBinding,
  IrSpreadBinding,
  IrTemplate,
  IrTemplateControllerBinding,
  IrTextBinding,
  IrViewFactory
} from './ir.js';
