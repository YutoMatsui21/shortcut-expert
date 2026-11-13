type Scope = {
  path: string[];
  keys: Set<string> | null;
  key: string;
  expectingKey: boolean;
};
type StringToken = { content: string; next: number };

function readStringToken(line: string, start: number): StringToken {
  let position = start + 1;
  while (position < line.length) {
    const char = line[position++];
    if (char === "\\") position++;
    else if (char === '"') {
      const content: unknown = JSON.parse(line.slice(start, position));
      if (typeof content !== "string") throw new Error("json-string");
      return { content, next: position };
    }
  }
  throw new Error("json-string");
}

function valuePath(scope: Scope | undefined): string[] {
  if (!scope) return [];
  // Only root/evidence discriminators matter. Deeper paths remain distinguishable
  // from those two levels without copying an unbounded path for every token.
  return [...scope.path, scope.keys ? scope.key : "[]"].slice(0, 3);
}

const independentDiscriminators = new Map([
  ['["route"]', "independent-results"],
  ['["evidence","kind"]', "independent-results"],
  ['["evidence","profile"]', "independent-results-v1"],
]);
function isIndependentDiscriminator(path: string[], content: string): boolean {
  return independentDiscriminators.get(JSON.stringify(path)) === content;
}

// This scanner only tracks names and wire discriminators. JSON.parse remains
// responsible for syntax; an explicit stack keeps valid deep legacy JSON legal.
class DuplicateKeyScanner {
  private position = 0;
  private scopes: Scope[] = [];
  private duplicate = false;
  private independent = false;

  private line: string;

  constructor(line: string) {
    this.line = line;
  }

  rejectsDuplicates(): boolean {
    while (this.position < this.line.length) this.consumeToken();
    return this.independent && this.duplicate;
  }

  private beginScope(char: string): void {
    const path = valuePath(this.scopes.at(-1));
    this.scopes.push({
      path,
      keys: char === "{" ? new Set() : null,
      key: "",
      expectingKey: char === "{",
    });
  }

  private expectPropertyName(): void {
    const scope = this.scopes.at(-1);
    if (scope?.keys) scope.expectingKey = true;
  }

  private expectPropertyValue(): void {
    const scope = this.scopes.at(-1);
    if (scope) scope.expectingKey = false;
  }

  private registerPropertyName(scope: Scope, content: string): void {
    if (scope.keys?.has(content)) this.duplicate = true;
    scope.keys?.add(content);
    scope.key = content;
  }

  private consumeString(): void {
    const { content, next } = readStringToken(this.line, this.position);
    const scope = this.scopes.at(-1);
    if (scope?.keys && scope.expectingKey)
      this.registerPropertyName(scope, content);
    else if (isIndependentDiscriminator(valuePath(scope), content))
      this.independent = true;
    this.position = next;
  }

  private consumeToken(): void {
    const char = this.line[this.position];
    switch (char) {
      case '"':
        this.consumeString();
        return;
      case "{":
      case "[":
        this.beginScope(char);
        break;
      case "}":
      case "]":
        this.scopes.pop();
        break;
      case ",":
        this.expectPropertyName();
        break;
      case ":":
        this.expectPropertyValue();
        break;
    }
    this.position++;
  }
}

// Inspect every discriminator before JSON.parse can overwrite duplicate names.
export function parseObserverMessage(line: string): unknown {
  if (line.length > 16384) throw new Error("oversize");
  if (new DuplicateKeyScanner(line).rejectsDuplicates())
    throw new Error("json-duplicate");
  return JSON.parse(line) as unknown;
}
