// Read-only rule lookup by knowledge id and edition. It reports sources and never runs a rule.

import type {
  Evidence,
  Id,
  KnowledgeEntry,
  RulesEdition,
} from '../../generated/contracts.ts';
import { evidenceBadge } from './sheet-model.ts';

export type RuleVerification = 'verified' | 'pending_review';

export interface RuleEntry extends KnowledgeEntry {
  kind: string;
  sourceLocator: string | null;
  verification: RuleVerification;
}

export type RuleLookup =
  | { status: 'found'; entry: RuleEntry }
  | { status: 'missing'; id: Id }
  | { status: 'wrong-edition'; entry: RuleEntry; expected: RulesEdition };

export interface RuleBook {
  lookup(id: Id, edition: RulesEdition): RuleLookup;
}

export interface RuleSummary {
  name: string;
  /** Null when the entry cannot be trusted for this sheet's edition. */
  body: string | null;
  /** BCP 47 tag of `name` and `body`; compendium text is not always in the UI language. */
  language: string | null;
  source: string;
  problem: string | null;
}

interface CompendiumCatalogRow {
  kind: string;
  source_locator: string;
  edition_verification: { status: string };
}

interface CompendiumEntry extends Omit<KnowledgeEntry, 'rules_edition' | 'provenance'> {
  rules_edition: string;
  provenance: { source: string; attribution: string; evidence: string };
}

/** The part of content/knowledge/compendium.json this feature reads. */
export interface CompendiumFile {
  catalog: Readonly<Record<string, CompendiumCatalogRow>>;
  knowledge_entries: readonly CompendiumEntry[];
}

export const RULES_EDITION_LABELS: Record<RulesEdition, string> = {
  dnd_2014: 'D&D 5e (2014)',
  dnd_2024: 'D&D 5e (2024)',
};

const VERIFICATION_LABELS: Record<RuleVerification, string> = {
  verified: 'Edition verified',
  pending_review: 'Pending review',
};

const NO_SOURCE = 'No source available';

function parseEdition(value: string): RulesEdition {
  if (value === 'dnd_2014' || value === 'dnd_2024') return value;
  throw new Error(`rule book: unknown rules edition "${value}"`);
}

function parseEvidence(value: string): Evidence {
  if (value === 'verified' || value === 'interpretation' || value === 'synthetic') return value;
  throw new Error(`rule book: unknown evidence "${value}"`);
}

function parseVerification(value: string, id: Id): RuleVerification {
  if (value === 'verified' || value === 'pending_review') return value;
  throw new Error(`rule book: unknown verification "${value}" on entry ${id}`);
}

function parseEntry(entry: CompendiumEntry, catalog: CompendiumFile['catalog']): RuleEntry {
  const row = catalog[entry.id];
  if (!row) throw new Error(`rule book: no catalog row for entry ${entry.id}`);
  return {
    ...entry,
    rules_edition: parseEdition(entry.rules_edition),
    provenance: { ...entry.provenance, evidence: parseEvidence(entry.provenance.evidence) },
    kind: row.kind,
    sourceLocator: row.source_locator,
    verification: parseVerification(row.edition_verification.status, entry.id),
  };
}

/** Validates the compendium at its boundary, failing on what it cannot vouch for. O(n). */
export function entriesFromCompendium(file: CompendiumFile): RuleEntry[] {
  return file.knowledge_entries.map((entry) => parseEntry(entry, file.catalog));
}

/** Indexes entries by id for constant-time lookups. O(n) to build. */
export function createRuleBook(entries: readonly RuleEntry[]): RuleBook {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return {
    lookup(id, edition) {
      const entry = byId.get(id);
      if (!entry) return { status: 'missing', id };
      if (entry.rules_edition !== edition) {
        return { status: 'wrong-edition', entry, expected: edition };
      }
      return { status: 'found', entry };
    },
  };
}

function sourceLine(entry: RuleEntry): string {
  const where = entry.sourceLocator ?? entry.provenance.source;
  const edition = RULES_EDITION_LABELS[entry.rules_edition];
  const verification = VERIFICATION_LABELS[entry.verification];
  const evidence = evidenceBadge(entry.provenance.evidence).label;
  return `${where} · ${edition} · ${verification} · ${evidence}`;
}

export function describeRule(lookup: RuleLookup): RuleSummary {
  if (lookup.status === 'missing') {
    return {
      name: 'Unknown rule',
      body: null,
      language: null,
      source: NO_SOURCE,
      problem: `No knowledge entry ${lookup.id} is available. Nothing is assumed about it.`,
    };
  }
  const { entry } = lookup;
  const summary = { name: entry.title, language: entry.language, source: sourceLine(entry) };
  if (lookup.status === 'found') return { ...summary, body: entry.body, problem: null };
  const entryEdition = RULES_EDITION_LABELS[entry.rules_edition];
  const expected = RULES_EDITION_LABELS[lookup.expected];
  const problem = `This entry is for ${entryEdition}, but the sheet uses ${expected}.`;
  return { ...summary, body: null, problem };
}
