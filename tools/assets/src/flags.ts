/** Command-line flags for the asset CLIs: `--name value` pairs, read once. */

export interface Flags {
  need(flag: string): string;
  optional(flag: string): string | undefined;
  /** A comma-separated list of exactly `count` finite numbers. */
  numbers(flag: string, count: number): number[];
}

export function readFlags(argv: string[]): Flags {
  const values = new Map<string, string>();
  for (let index = 0; index + 1 < argv.length; index += 2) values.set(argv[index], argv[index + 1]);
  const need = (flag: string) => {
    const value = values.get(flag);
    if (value === undefined) throw new Error(`missing ${flag}`);
    return value;
  };
  const numbers = (flag: string, count: number) => {
    const list = need(flag).split(',').map(Number);
    if (list.length !== count || list.some((value) => !Number.isFinite(value))) {
      throw new Error(`${flag} needs ${count} comma-separated numbers`);
    }
    return list;
  };
  return { need, optional: (flag) => values.get(flag), numbers };
}
