// Both bootstrap isolation and ARM gating must recognize exactly the same flags.
export function naturalInputOperation(argv: readonly string[]): 'W08' | 'W12' | null {
  if (argv.includes('--w12-natural-acceptance')) return 'W12';
  if (argv.includes('--w08-natural-acceptance')) return 'W08';
  return null;
}
