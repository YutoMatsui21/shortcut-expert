import type { Bounds } from "../shared/coach";

export type Fields = Record<string, unknown>;
type Reader<T> = (value: unknown) => T | undefined;
type Readers<T> = { [K in keyof T]-?: Reader<T[K]> };

export function record(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// An undefined result rejects the message. Null is a valid value for some fields.
// Build a new object from the declared fields so extra data never gets forwarded.
function project<T>(
  value: Fields,
  readers: Readers<T>,
  keys: (keyof T & string)[],
): T | undefined {
  const result: Partial<T> = {};
  for (const key of keys) {
    const field = readers[key](value[key]);
    if (field === undefined) return undefined;
    result[key] = field;
  }
  // Readers declares every field of T. The loop fills them all before returning.
  return result as T;
}

export function fields<T>(readers: Readers<T>): Reader<T> {
  const keys: (keyof T & string)[] = [];
  for (const key in readers) {
    if (Object.hasOwn(readers, key)) keys.push(key);
  }
  return (value) => (record(value) ? project(value, readers, keys) : undefined);
}

export function oneOf<const T>(...allowed: T[]): Reader<T> {
  return (value) => allowed.find((option) => option === value);
}

export function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function nullable<T>(read: Reader<T>): Reader<T | null> {
  return (value) => (value === null ? null : read(value));
}

export function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function milliseconds(value: unknown): number | undefined {
  const number = finite(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

export function protocolId(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 0x7fffffff
  );
}

export function slotUpTo(maximum: number): Reader<number | null> {
  return nullable((value) =>
    protocolId(value) && value <= maximum ? value : undefined,
  );
}

function dimension(value: unknown): number | undefined {
  const number = finite(value);
  return number !== undefined && number > 0 ? number : undefined;
}

export const bounds = fields<Bounds>({
  x: finite,
  y: finite,
  width: dimension,
  height: dimension,
});

export const nullableBounds = nullable(bounds);
export const nullableBoolean = nullable(boolean);
export const moveDirection = oneOf(null, "left", "right");

export function booleanFlag(
  fields: Fields,
  name: string,
): boolean | null | undefined {
  return name in fields ? boolean(fields[name]) : null;
}
