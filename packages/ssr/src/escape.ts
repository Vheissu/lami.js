const htmlEscapes = new Map<string, string>([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;']
]);

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => htmlEscapes.get(char)!);
}

export function escapeAttribute(value: unknown): string {
  return escapeHtml(value);
}
