import { enhance, reactive, type ElementDefinition } from '@lami.js/runtime';

export function defineAsWebComponent<TInstance extends object>(definition: ElementDefinition<TInstance>): CustomElementConstructor {
  class LamiElement extends HTMLElement {
    private handle: ReturnType<typeof enhance> | undefined;
    private instance: TInstance | undefined;

    static get observedAttributes(): string[] {
      return Object.keys(definition.bindables ?? {}).map(name => name.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`));
    }

    connectedCallback(): void {
      if (this.handle) return;
      this.instance = reactive(new definition.Type());
      const root = definition.shadow === 'open'
        ? this.shadowRoot ?? this.attachShadow({ mode: 'open' })
        : this;

      if (typeof definition.template === 'string') {
        root.innerHTML = definition.template;
      } else {
        root.append(definition.template.content.cloneNode(true));
      }

      this.syncAttributes();
      this.handle = enhance(root, this.instance);
    }

    disconnectedCallback(): void {
      this.handle?.dispose();
      this.handle = undefined;
    }

    attributeChangedCallback(): void {
      this.syncAttributes();
    }

    private syncAttributes(): void {
      if (!this.instance) return;
      for (const [name, bindable] of Object.entries(definition.bindables ?? {})) {
        const attrName = name.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`);
        if (!this.hasAttribute(attrName)) continue;
        const rawValue = this.getAttribute(attrName);
        (this.instance as Record<string, unknown>)[bindable.property ?? name] = bindable.set
          ? bindable.set(rawValue)
          : rawValue;
      }
    }
  }

  customElements.define(definition.name, LamiElement);
  return LamiElement;
}
