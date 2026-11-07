// A synthetic encounter over the demo sheets. The caller supplies the place, so no city leaks in.

import type { EncounterParticipant, Id } from '../../generated/contracts.ts';
import {
  DEMO_CAMPAIGN_ID,
  DEMO_PROVENANCE,
  DEMO_RULES_EDITION,
  DEMO_SHEETS,
  IONYTH_SHEET,
} from '../characters/demo-sheets.ts';
import type { EncounterBundle } from './encounter-model.ts';

const ENCOUNTER_ID = '00000000-0000-4000-8000-00000000d601';
/** Demo initiatives in sheet order. The last one is unset, to show that state. */
const DEMO_INITIATIVES: readonly (number | null)[] = [18, 14, null];

export function createDemoEncounter(placeId: Id): EncounterBundle {
  const participants: EncounterParticipant[] = DEMO_SHEETS.map((sheet, index) => ({
    campaign_id: DEMO_CAMPAIGN_ID,
    actor_id: sheet.actor.id,
    encounter_id: ENCOUNTER_ID,
    initiative: DEMO_INITIATIVES[index] ?? null,
  }));
  return {
    encounter: {
      id: ENCOUNTER_ID,
      campaign_id: DEMO_CAMPAIGN_ID,
      place_id: placeId,
      scene_id: null,
      name: 'Demo skirmish',
      status: 'active',
      round_number: 1,
      revision: 1,
    },
    participants,
    sheets: [...DEMO_SHEETS, IONYTH_SHEET],
    provenance: DEMO_PROVENANCE,
    rulesEdition: DEMO_RULES_EDITION,
  };
}
