import { parseTemplateAst } from './parse-html.js';
import { compileToIr, type IrTemplate } from './ir.js';
import { emitDomModule } from './codegen-dom.js';
import { emitHydrateModule } from './codegen-hydrate.js';
import { emitSsrModule } from './codegen-ssr.js';
import { createCompileDiagnostics, type CompileDiagnostic } from './diagnostics.js';
import type { TemplateAst } from './ast.js';

export interface CompileOptions {
  mode: 'dom' | 'ssr' | 'hydrate';
  moduleFormat?: 'esm';
  filename?: string;
  sourcemap?: boolean;
  dev?: boolean;
}

export interface CompileWarning {
  code: string;
  message: string;
  hint?: string;
  path?: number[];
  loc?: CompileDiagnostic['loc'];
  source?: string;
}

export interface TemplateMetadata {
  mode: CompileOptions['mode'];
  filename?: string;
  nodeCount: number;
  ast: TemplateAst;
  ir: IrTemplate;
}

export interface CompileResult {
  code: string;
  map?: string;
  warnings: CompileWarning[];
  diagnostics: CompileDiagnostic[];
  metadata: TemplateMetadata;
}

export function compileTemplate(source: string, options: CompileOptions): CompileResult {
  const ast = parseTemplateAst(source);
  const ir = compileToIr(source);
  const metadata: TemplateMetadata = {
    mode: options.mode,
    ...(options.filename ? { filename: options.filename } : {}),
    nodeCount: countNodes(ast.root.children),
    ast,
    ir
  };

  const code = options.mode === 'ssr'
    ? emitSsrModule(source, ir)
    : options.mode === 'hydrate'
      ? emitHydrateModule(ir)
      : emitDomModule(source, ir);
  const { warnings, diagnostics } = createCompileDiagnostics(ir, options, source);

  return {
    code,
    warnings,
    diagnostics,
    metadata
  };
}

function countNodes(nodes: TemplateAst['root']['children']): number {
  let count = nodes.length;
  for (const node of nodes) {
    if (node.kind === 'element') count += countNodes(node.children);
  }
  return count;
}
