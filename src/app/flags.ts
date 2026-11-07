// Browser runtime flags: the `name = on|off` file `crates/core/src/flags.rs` reads, injected into
// the page as a meta tag by Vite (see docs/flags.md). Off by default: no tag, no file or an
// unreadable one leaves every flag off, which is the behaviour before the flag existed.

/** The flag that swaps the pre-flag placeholder for the campaign hub shell. */
export const CAMPAIGN_HUB = 'campaign_hub';

/** The flag that opens the optional scroll prologue before a campaign's table. */
export const CAMPAIGN_PROLOGUE = 'campaign_prologue';

/** Meta tag the dev and build pipeline fills with the flags file text. */
export const FLAGS_META = 'desire-flags';

/** Reads the flags text: a meta tag in the page, or anything else a caller injects. */
export type FlagReader = () => string | null;

function readMeta(): string | null {
  const meta = document.querySelector(`meta[name="${FLAGS_META}"]`);
  return meta?.getAttribute('content') ?? null;
}

/** Parse `name = on|off` lines. Later lines win. O(lines). */
export function parseFlags(text: string): ReadonlySet<string> {
  const enabled = new Set<string>();
  text.split('\n').forEach((raw, index) => {
    const line = raw.split('#')[0].trim();
    if (line === '') return;
    const split = line.indexOf('=');
    if (split < 0) throw new Error(`${malformed(raw, index)}: no "="`);
    const name = line.slice(0, split).trim();
    const value = line.slice(split + 1).trim();
    if (value === 'on') enabled.add(name);
    else if (value === 'off') enabled.delete(name);
    else throw new Error(`${malformed(raw, index)}: expected \`on\` or \`off\``);
  });
  return enabled;
}

function malformed(raw: string, index: number): string {
  return `flags line ${index + 1}: "${raw}" is not \`name = on|off\``;
}

/** The flags of this page. A malformed file is reported and ignored, never guessed. */
export function flagsFromPage(read: FlagReader = readMeta): ReadonlySet<string> {
  try {
    return parseFlags(read() ?? '');
  } catch (error) {
    console.warn('flags: ignoring an unreadable flags file; using the default (off)', error);
    return new Set();
  }
}
