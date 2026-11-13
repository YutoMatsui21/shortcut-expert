// JSON.parse discards duplicate names. Inspect object scopes before parsing the
// message, retaining every discriminator even when a later key overwrites it.
export function parseObserverMessage(line: string): unknown {
  if (line.length > 16384) throw new Error("oversize");
  type Scope = {
    path: string[];
    keys: Set<string> | null;
    key: string;
    expectingKey: boolean;
  };
  const scopes: Scope[] = [];
  let position = 0,
    duplicate = false,
    independent = false;
  function string(): string {
    const start = position++;
    while (position < line.length) {
      const char = line[position++];
      if (char === "\\") position++;
      else if (char === '"') {
        const decoded: unknown = JSON.parse(line.slice(start, position));
        if (typeof decoded !== "string") throw new Error("json-string");
        return decoded;
      }
    }
    throw new Error("json-string");
  }
  while (position < line.length) {
    const scope = scopes.at(-1),
      char = line[position];
    const path = scope
      ? [...scope.path, scope.keys ? scope.key : "[]"].slice(0, 3)
      : [];
    if (char === "{" || char === "[") {
      scopes.push({
        path,
        keys: char === "{" ? new Set() : null,
        key: "",
        expectingKey: char === "{",
      });
      position++;
    } else if (char === "}" || char === "]") {
      scopes.pop();
      position++;
    } else if (char === ",") {
      if (scope?.keys) scope.expectingKey = true;
      position++;
    } else if (char === ":") {
      if (scope) scope.expectingKey = false;
      position++;
    } else if (char === '"') {
      const content = string();
      if (scope?.keys && scope.expectingKey) {
        if (scope.keys.has(content)) duplicate = true;
        scope.keys.add(content);
        scope.key = content;
      } else if (
        (path.length === 1 &&
          path[0] === "route" &&
          content === "independent-results") ||
        (path.length === 2 &&
          path[0] === "evidence" &&
          ((path[1] === "kind" && content === "independent-results") ||
            (path[1] === "profile" && content === "independent-results-v1")))
      )
        independent = true;
    } else position++;
  }
  if (independent && duplicate) throw new Error("json-duplicate");
  return JSON.parse(line) as unknown;
}
