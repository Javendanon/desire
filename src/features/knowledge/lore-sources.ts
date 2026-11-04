// Gathers lore for one campaign. Places and the compendium ship with the app, so a failing API
// degrades the panel to local content instead of hiding what is useful during play.
import type {
  CampaignKnowledge,
  Id,
  RulesEdition,
} from '../../generated/contracts.ts';
import type { MapPlace } from '../../lib/engine/plan/map-definition.ts';
import { isAbort } from '../campaign/failures.ts';
import type { Collected } from '../campaign/pages.ts';
import { buildLoreIndex, type LoreEntry } from './lore-index.ts';
import type { CompendiumDocument } from './search.ts';

export interface LoreRequest {
  cityId: Id | null;
  rulesEdition: RulesEdition;
}

export interface LoreDependencies {
  loadPlaces(cityId: Id | null): Promise<readonly MapPlace[]>;
  loadCompendium(): Promise<CompendiumDocument>;
  loadNotes(): Promise<Collected<CampaignKnowledge>>;
}

export interface LoreCollection {
  index: LoreEntry[];
  notesFailure: unknown;
  notesTruncated: boolean;
}

interface NotesOutcome {
  notes: Collected<CampaignKnowledge>;
  failure: unknown;
}

async function loadNotesOutcome(dependencies: LoreDependencies): Promise<NotesOutcome> {
  try {
    return { notes: await dependencies.loadNotes(), failure: null };
  } catch (error) {
    if (isAbort(error)) throw error;
    return { notes: { items: [], truncated: false }, failure: error };
  }
}

export async function collectLore(
  request: LoreRequest,
  dependencies: LoreDependencies,
): Promise<LoreCollection> {
  const [places, compendium, outcome] = await Promise.all([
    dependencies.loadPlaces(request.cityId),
    dependencies.loadCompendium(),
    loadNotesOutcome(dependencies),
  ]);
  const index = buildLoreIndex({
    places,
    compendium,
    campaignNotes: outcome.notes.items,
    rulesEdition: request.rulesEdition,
  });
  return { index, notesFailure: outcome.failure, notesTruncated: outcome.notes.truncated };
}

export async function loadCompendium(): Promise<CompendiumDocument> {
  const imported = await import('../../../content/knowledge/compendium.json');
  return imported.default as unknown as CompendiumDocument;
}
