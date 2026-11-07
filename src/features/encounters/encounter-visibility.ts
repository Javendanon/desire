// Defensive UI projection. The server must still omit secrets from player payloads.
import type { EncounterBundle } from './encounter-model.ts';

/** O(sheets + participants). Deny DM records unless the host explicitly grants access. */
export function visibleEncounter(bundle: EncounterBundle, canSeeDm: boolean): EncounterBundle {
  if (canSeeDm) return bundle;
  const sheets = bundle.sheets.filter((sheet) => sheet.actor.visibility !== 'dm');
  const visibleIds = new Set(sheets.map((sheet) => sheet.actor.id));
  return {
    ...bundle,
    sheets,
    participants: bundle.participants.filter((entry) => visibleIds.has(entry.actor_id)),
  };
}
