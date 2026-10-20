/** Flat output files must stay inside the chosen directory and never follow symlinks. */
import fs from 'node:fs';
import path from 'node:path';

export function outputPath(directory: string, name: string): string {
  const root = fs.realpathSync(directory);
  const file = path.resolve(root, name);
  if (path.dirname(file) !== root) throw new Error(`output escapes directory: ${name}`);
  if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`output must not be a symlink: ${file}`);
  }
  return file;
}
