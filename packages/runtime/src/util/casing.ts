export function kebabToCamel(value: string): string {
  return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

export function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`);
}

export function normalizeResourceName(value: string): string {
  return value.toLowerCase();
}
