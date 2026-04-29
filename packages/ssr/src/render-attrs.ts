import { escapeAttribute } from './escape.js';

export function renderAttrs(attrs: Record<string, unknown>): string {
  let html = '';

  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (value === true) {
      html += ` ${name}`;
    } else {
      html += ` ${name}="${escapeAttribute(value)}"`;
    }
  }

  return html;
}
