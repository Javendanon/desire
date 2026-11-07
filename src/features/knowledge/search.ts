// Compendium matcher implementing content/knowledge/search-fixtures.json, which is normative.
import type { KnowledgeEntry } from '../../generated/contracts.ts';

export interface CompendiumReference {
  relation: string;
  target: string;
}

export interface CompendiumCatalogRecord {
  slug: string;
  kind: string;
  translation_status: string;
  references: readonly CompendiumReference[];
}

export interface CompendiumDocument {
  catalog: Readonly<Record<string, CompendiumCatalogRecord>>;
  knowledge_entries: readonly KnowledgeEntry[];
}

export interface CompendiumFilters {
  kind?: string;
  rules_edition?: string;
  language?: string;
  translation_status?: string;
}

const COMBINING_MARKS = /\p{M}/gu;
const WHITESPACE = /\s+/;

export function normalizeText(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(COMBINING_MARKS, '');
}

export function queryTokens(query: string): string[] {
  return normalizeText(query).split(WHITESPACE).filter(Boolean);
}

export function matchesTokens(haystack: string, tokens: readonly string[]): boolean {
  return tokens.every((token) => haystack.includes(token));
}

export function compendiumHaystack(
  entry: KnowledgeEntry,
  record: CompendiumCatalogRecord,
): string {
  const targets = record.references.map((reference) => reference.target);
  return normalizeText(
    [entry.title, entry.body, record.slug, record.kind, ...targets].join(' '),
  );
}

function passesFilters(
  entry: KnowledgeEntry,
  record: CompendiumCatalogRecord,
  filters: CompendiumFilters,
): boolean {
  return (
    (filters.kind === undefined || record.kind === filters.kind) &&
    (filters.rules_edition === undefined || entry.rules_edition === filters.rules_edition) &&
    (filters.language === undefined || entry.language === filters.language) &&
    (filters.translation_status === undefined ||
      record.translation_status === filters.translation_status)
  );
}

/** Text search plus filters over the local compendium. O(entries). */
export function searchCompendium(
  document: CompendiumDocument,
  query: string,
  filters: CompendiumFilters = {},
): KnowledgeEntry[] {
  const tokens = queryTokens(query);
  return document.knowledge_entries.filter((entry) => {
    const record = document.catalog[entry.id];
    if (!passesFilters(entry, record, filters)) return false;
    return matchesTokens(compendiumHaystack(entry, record), tokens);
  });
}
