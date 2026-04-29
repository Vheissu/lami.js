export type Cleanup = () => void;

export function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

export function isText(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE;
}

export function childNodes(parent: Node): Node[] {
  return Array.from(parent.childNodes);
}

export function insertAllBefore(nodes: Node[], parent: Node, reference: Node): void {
  for (const node of nodes) {
    parent.insertBefore(node, reference);
  }
}

export function removeAll(nodes: Node[]): void {
  for (const node of nodes) {
    node.parentNode?.removeChild(node);
  }
}

export function parseTemplate(html: string | HTMLTemplateElement, ownerDocument: Document = document): DocumentFragment {
  if (typeof html !== 'string') {
    return html.content.cloneNode(true) as DocumentFragment;
  }

  const template = ownerDocument.createElement('template');
  template.innerHTML = html;
  return template.content.cloneNode(true) as DocumentFragment;
}

export function path(root: Node, indexes: number[]): Node {
  let cursor: Node = root;
  for (const index of indexes) {
    const next = cursor.childNodes.item(index);
    if (!next) {
      throw new Error(`DOM path ${indexes.join('.')} could not be resolved`);
    }
    cursor = next;
  }
  return cursor;
}
