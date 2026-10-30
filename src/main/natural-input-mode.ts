// Both bootstrap isolation and ARM gating must recognize exactly the same flags.
export function naturalInputOperation(argv: readonly string[]): 'W01' | 'W08' | 'W12' | 'ALL' | null {
  if (argv.includes('--final-natural-acceptance')) return 'ALL';
  if (argv.includes('--w01-natural-acceptance')) return 'W01';
  if (argv.includes('--w12-natural-acceptance')) return 'W12';
  if (argv.includes('--w08-natural-acceptance')) return 'W08';
  return null;
}
