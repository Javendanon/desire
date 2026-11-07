// Display decisions for lore results: copy keys per kind and the map link that keeps context.
import type { MessageKey } from '../../app/messages.ts';
import {
  withContext,
  withPanel,
  type CampaignRoute,
} from '../../app/routes.ts';
import { CAMPAIGN_KIND, PLACE_KIND, type LoreEntry } from './lore-index.ts';

const KIND_LABELS: Readonly<Record<string, MessageKey>> = {
  [PLACE_KIND]: 'kind.place',
  [CAMPAIGN_KIND]: 'kind.campaign_note',
  spell: 'kind.spell',
  class: 'kind.class',
  condition: 'kind.condition',
};

export function kindLabelKey(kind: string): MessageKey {
  return KIND_LABELS[kind] ?? 'kind.other';
}

/** Back to the atlas: a place entry becomes the selection, anything else keeps the current one. */
export function mapRouteFor(route: CampaignRoute, entry: LoreEntry | null): CampaignRoute {
  const place = entry?.placeId ?? route.context.place;
  return withPanel(withContext(route, { place }), 'atlas');
}
