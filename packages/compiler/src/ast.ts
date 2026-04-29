import type { AttributeSyntax } from '@lami.js/runtime';

export interface TemplateAst {
  root: AstFragment;
  resources: ImportDeclaration[];
}

export interface SourceLocation {
  line: number;
  column: number;
  offset: number;
  endLine: number;
  endColumn: number;
  endOffset: number;
}

export interface ImportDeclaration {
  source: string;
  specifiers: string[];
}

export type AstNode = AstElement | AstText | AstComment;

export interface AstFragment {
  kind: 'fragment';
  children: AstNode[];
}

export interface AstElement {
  kind: 'element';
  tagName: string;
  attrs: AstAttribute[];
  children: AstNode[];
  loc?: SourceLocation;
}

export interface AstAttribute {
  name: string;
  value: string;
  syntax: AttributeSyntax;
  loc?: SourceLocation;
}

export interface AstText {
  kind: 'text';
  value: string;
  loc?: SourceLocation;
}

export interface AstComment {
  kind: 'comment';
  value: string;
  loc?: SourceLocation;
}
