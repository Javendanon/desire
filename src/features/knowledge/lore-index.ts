// One searchable list over map places, campaign notes and the compendium for the campaign's
// rules edition. Pure data in and out; visibility is already decided by the server's answer.
import type {
  CampaignKnowledge,
  RulesEdition,
  Visibility,
} from '../../generated/contracts.ts';
import type { MapPlace } from '../../lib/engine/plan/map-definition.ts';
import {
  compendiumHaystack,
  matchesTokens,
  normalizeText,
  queryTokens,
  type CompendiumDocument,
} from './search.ts';

export const PLACE_KIND = 'place';
export const CAMPAIGN_KIND = 'campaign_note';
export const ALL_KINDS = 'all';

export interface LoreEntry {
  key: string;
  kind: string;
  title: string;
  body: string;
  attribution: string | null;
  visibility: Visibility | null;
  placeId: string | null;
  haystack: string;
}

export interface LoreSources {
  places: readonly MapPlace[];
  campaignNotes: readonly CampaignKnowledge[];
  compendium: CompendiumDocument;
  rulesEdition: RulesEdition;
}

function placeEntry(place: MapPlace): LoreEntry {
  return {
    key: `place:${place.id}`,
    kind: PLACE_KIND,
    title: place.name,
    body: '',
    attribution: place.sourceRef,
    visibility: null,
    placeId: place.id,
    haystack: normalizeText([place.name, place.ward ?? '', place.catalogId].join(' ')),
  };
}

function noteEntry(note: CampaignKnowledge): LoreEntry {
  return {
    key: `campaign:${note.id}`,
    kind: CAMPAIGN_KIND,
    title: note.title,
    body: note.body,
    attribution: note.provenance.attribution,
    visibility: note.visibility,
    placeId: null,
    haystack: normalizeText(`${note.title} ${note.body}`),
  };
}

function compendiumEntries(
  document: CompendiumDocument,
  rulesEdition: RulesEdition,
): LoreEntry[] {
  const inEdition = document.knowledge_entries.filter(
    (entry) => entry.rules_edition === rulesEdition,
  );
  return inEdition.map((entry) => {
    const record = document.catalog[entry.id];
    return {
      key: `compendium:${entry.id}`,
      kind: record.kind,
      title: entry.title,
      body: entry.body,
      attribution: entry.provenance.attribution,
      visibility: null,
      placeId: null,
      haystack: compendiumHaystack(entry, record),
    };
  });
}

/** Builds the index once per load, so typing a query never re-normalizes text. O(n log n). */
export function buildLoreIndex(sources: LoreSources): LoreEntry[] {
  const entries = [
    ...sources.places.map(placeEntry),
    ...sources.campaignNotes.map(noteEntry),
    ...compendiumEntries(sources.compendium, sources.rulesEdition),
  ];
  return entries.sort((left, right) => left.title.localeCompare(right.title, 'es'));
}

/** O(entries · tokens). */
export function searchLore(
  index: readonly LoreEntry[],
  query: string,
  kind: string = ALL_KINDS,
): LoreEntry[] {
  const tokens = queryTokens(query);
  return index.filter(
    (entry) =>
      (kind === ALL_KINDS || entry.kind === kind) && matchesTokens(entry.haystack, tokens),
  );
}

/** Kinds present in the index, in first-seen order. O(entries). */
export function loreKinds(index: readonly LoreEntry[]): string[] {
  return [...new Set(index.map((entry) => entry.kind))];
}
