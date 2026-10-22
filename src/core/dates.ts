function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && formatUtcDate(date) === value;
}
export function cutoffDate(today: string): string {
  const date = new Date(today + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() - 29);
  return formatUtcDate(date);
}
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
