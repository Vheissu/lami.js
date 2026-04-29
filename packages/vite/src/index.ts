import type { Plugin } from 'vite';
import { compileTemplate } from '@lami.js/compiler';

export interface LamiPluginOptions {
  include?: RegExp | string | Array<RegExp | string>;
  ssr?: boolean;
  hydrate?: boolean;
  dev?: boolean;
}

export function lami(options: LamiPluginOptions = {}): Plugin {
  const include = options.include ?? /\.lami\.html$/;

  return {
    name: 'lami.js',
    transform(code, id) {
      if (!matches(include, id)) return null;
      const result = compileTemplate(code, {
        mode: resolveMode(options),
        filename: id,
        ...(options.dev === undefined ? {} : { dev: options.dev })
      });
      return {
        code: result.code,
        map: result.map ?? null
      };
    }
  };
}

export { lami as Lami, lami as lamiJs };

function resolveMode(options: LamiPluginOptions): 'dom' | 'ssr' | 'hydrate' {
  if (options.ssr) return 'ssr';
  if (options.hydrate) return 'hydrate';
  return 'dom';
}

function matches(include: LamiPluginOptions['include'], id: string): boolean {
  const items = Array.isArray(include) ? include : [include];
  return items.some(item => {
    if (item instanceof RegExp) return item.test(id);
    return typeof item === 'string' && id.endsWith(item);
  });
}
