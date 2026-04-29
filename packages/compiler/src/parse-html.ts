import * as parse5 from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { parseAttributeSyntax } from '@lami.js/runtime';
import type { AstElement, AstNode, SourceLocation, TemplateAst } from './ast.js';

type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type ElementNode = DefaultTreeAdapterTypes.Element & {
  content?: DefaultTreeAdapterTypes.DocumentFragment;
};
type TextNode = DefaultTreeAdapterTypes.TextNode;
type CommentNode = DefaultTreeAdapterTypes.CommentNode;

export function parseTemplateAst(source: string): TemplateAst {
  const fragment = parse5.parseFragment(source, {
    sourceCodeLocationInfo: true
  });
  return {
    root: {
      kind: 'fragment',
      children: fragment.childNodes.map(convertNode).filter(Boolean) as AstNode[]
    },
    resources: []
  };
}

function convertNode(node: ChildNode): AstNode | null {
  if (isTextNode(node)) return withLocation({ kind: 'text', value: node.value }, node);
  if (isCommentNode(node)) return withLocation({ kind: 'comment', value: node.data }, node);
  if (!isElementNode(node)) return null;

  const element: AstElement = {
    kind: 'element',
    tagName: node.tagName,
    attrs: node.attrs.map(attr => ({
      name: attr.name,
      value: attr.value,
      syntax: parseAttributeSyntax(attr.name, attr.value),
      ...attributeLocation(node, attr.name)
    })),
    children: childNodesOf(node).map(convertNode).filter(Boolean) as AstNode[]
  };

  return withLocation(element, node);
}

function childNodesOf(node: ElementNode): ChildNode[] {
  return node.tagName === 'template' && node.content
    ? node.content.childNodes
    : node.childNodes;
}

function isTextNode(node: ChildNode): node is TextNode {
  return node.nodeName === '#text';
}

function isCommentNode(node: ChildNode): node is CommentNode {
  return node.nodeName === '#comment';
}

function isElementNode(node: ChildNode): node is ElementNode {
  return 'tagName' in node;
}

function withLocation<T extends AstNode>(astNode: T, sourceNode: ChildNode): T {
  const loc = sourceLocation((sourceNode as { sourceCodeLocation?: unknown }).sourceCodeLocation);
  return loc ? { ...astNode, loc } : astNode;
}

function attributeLocation(node: ElementNode, name: string): { loc?: SourceLocation } {
  const attrs = (node as { sourceCodeLocation?: { attrs?: Record<string, unknown> } }).sourceCodeLocation?.attrs;
  const loc = sourceLocation(attrs?.[name]);
  return loc ? { loc } : {};
}

function sourceLocation(value: unknown): SourceLocation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const location = value as {
    startLine?: number;
    startCol?: number;
    startOffset?: number;
    endLine?: number;
    endCol?: number;
    endOffset?: number;
  };
  if (
    location.startLine === undefined ||
    location.startCol === undefined ||
    location.startOffset === undefined ||
    location.endLine === undefined ||
    location.endCol === undefined ||
    location.endOffset === undefined
  ) {
    return undefined;
  }

  return {
    line: location.startLine,
    column: location.startCol,
    offset: location.startOffset,
    endLine: location.endLine,
    endColumn: location.endCol,
    endOffset: location.endOffset
  };
}
