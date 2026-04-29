export function hydrationMarkerId(kind: string, path: number[], source: string): string {
  return `${kind}:${path.join('_') || 'root'}:${hash(`${kind}:${path.join('.')}:${source}`)}`;
}

function hash(value: string): string {
  let next = 2166136261;
  for (let index = 0; index < value.length; index++) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, 16777619);
  }
  return (next >>> 0).toString(36);
}
