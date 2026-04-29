export type BindingCommandName =
  | 'bind'
  | 'to-view'
  | 'one-way'
  | 'two-way'
  | 'from-view'
  | 'one-time'
  | 'attr'
  | 'trigger'
  | 'capture'
  | 'class'
  | 'style'
  | 'ref'
  | 'for'
  | null;

export interface AttributeSyntax {
  rawName: string;
  rawValue: string;
  target: string;
  command: BindingCommandName;
  modifiers: string[];
}

export function parseAttributeSyntax(rawName: string, rawValue: string): AttributeSyntax {
  if (rawName.startsWith('@')) {
    const parsed = parseNameAndModifiers(rawName.slice(1));
    return {
      rawName,
      rawValue,
      target: parsed.target,
      command: 'trigger',
      modifiers: parsed.modifiers
    };
  }

  if (rawName.startsWith('...')) {
    return {
      rawName,
      rawValue,
      target: rawName.slice(3),
      command: null,
      modifiers: []
    };
  }

  const parsedName = parseNameAndModifiers(rawName);
  const lastDot = parsedName.target.lastIndexOf('.');
  if (lastDot === -1) {
    return {
      rawName,
      rawValue,
      target: rawName,
      command: null,
      modifiers: []
    };
  }

  const target = parsedName.target.slice(0, lastDot);
  const command = parsedName.target.slice(lastDot + 1);

  return {
    rawName,
    rawValue,
    target,
    command: command as BindingCommandName,
    modifiers: parsedName.modifiers
  };
}

export function parseCustomAttributeOptions(value: string, defaultProperty = 'value'): Array<{
  property: string;
  command: BindingCommandName;
  expression: string;
}> {
  const parts = splitSemicolon(value);
  if (parts.length === 1 && !parts[0]!.includes(':')) {
    return [{ property: defaultProperty, command: null, expression: parts[0]!.trim() }];
  }

  return parts
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const separator = part.indexOf(':');
      if (separator === -1) {
        return { property: defaultProperty, command: null, expression: part.trim() };
      }

      const propertySyntax = part.slice(0, separator).trim();
      const expression = part.slice(separator + 1).trim();
      const syntax = parseAttributeSyntax(propertySyntax, expression);
      return {
        property: syntax.target,
        command: syntax.command,
        expression
      };
    });
}

function parseNameAndModifiers(value: string): { target: string; modifiers: string[] } {
  const [target, modifierText] = value.split(':', 2);
  return {
    target: target ?? '',
    modifiers: modifierText ? modifierText.split('.').flatMap(part => part.split('+')).filter(Boolean) : []
  };
}

function splitSemicolon(value: string): string[] {
  const result: string[] = [];
  let quote: string | null = null;
  let start = 0;

  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char;
      continue;
    }

    if (char === ';' && quote === null) {
      result.push(value.slice(start, index));
      start = index + 1;
    }
  }

  result.push(value.slice(start));
  return result;
}
