# Compiler, SSR, And Hydration

Lami.js can run templates through the runtime enhancer or through generated
modules. The compiler exists to remove DOM scanning and template parsing from
hot browser paths where that matters.

## Compiler API

```ts
import { compileTemplate } from '@lami.js/compiler';

const result = compileTemplate('<p>${name}</p>', {
  mode: 'dom',
  filename: 'hello.lami.html'
});
```

Modes:

- `dom` emits a browser module that creates and binds DOM.
- `ssr` emits a server renderer.
- `hydrate` emits a browser module that attaches to existing SSR DOM.

Compiler results include generated `code`, `warnings`, and metadata containing
the parsed AST and IR.

The direct DOM mode covers text and attribute interpolation, property/form
bindings, events, refs, spread, class/style/show/hide, the current template
controller family, and lightweight custom elements with bindables, lifecycle
callbacks, and slot projection. If a future instruction is not supported by
direct DOM output, the compiler can still emit the runtime-backed module path.

## CLI

```bash
lami compile src/contact.html --mode dom --outDir .lami
lami compile src/pages --mode ssr --outDir .lami-ssr
lami compile src/contact.html --mode hydrate --outDir .lami
```

## Vite Plugin

```ts
import { lami } from '@lami.js/vite';

export default {
  plugins: [
    lami({
      include: /\.lami\.html$/,
      dev: true
    })
  ]
};
```

Plugin options:

```ts
interface LamiPluginOptions {
  include?: RegExp | string | Array<RegExp | string>;
  ssr?: boolean;
  hydrate?: boolean;
  dev?: boolean;
}
```

Set `ssr` or `hydrate` to select those compiler modes. Without either option,
the plugin emits DOM modules.

## Runtime SSR

```ts
import { renderRuntimeTemplate } from '@lami.js/ssr';

const html = await renderRuntimeTemplate('<p>${name}</p>', {
  name: 'Lami'
});
```

Runtime SSR supports interpolation, attributes, forms-friendly property output,
repeat, if/else, with, switch, promise, spread attributes, class/style,
show/hide, and escaping.

## Hydration

SSR output uses markers for controller ranges so hydration can attach without
recreating nodes. The direct hydration path supports:

- path-stable text and attribute bindings
- property/form bindings
- events
- refs
- spread
- class/style token bindings
- show/hide
- `<let>` locals
- root and nested controller ranges for `if`, `repeat`, `with`, `switch`, and
  `promise`

Unsupported future instructions can still fall back to runtime-backed
hydration modules.

## Node ESM Contract

Published packages emit `.js` relative import specifiers. This is required so
the tarballs work under Node's native ESM loader, not just bundlers.
