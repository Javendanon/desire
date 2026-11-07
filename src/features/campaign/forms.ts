// Client checks that spare a round trip for an obvious mistake. The server validates again.
import type { MessageKey } from '../../app/messages.ts';
import type { RulesEdition } from '../../generated/contracts.ts';
import type { NewCampaign } from '../../lib/api/campaigns.ts';

export const NAME_MAX_LENGTH = 120;
export const TITLE_MAX_LENGTH = 200;
export const DEFAULT_EDITION: RulesEdition = 'dnd_2014';

export interface EditionOption {
  value: RulesEdition;
  label: MessageKey;
}

export const EDITION_OPTIONS: readonly EditionOption[] = [
  { value: 'dnd_2014', label: 'edition.dnd_2014' },
  { value: 'dnd_2024', label: 'edition.dnd_2024' },
];

export function validateName(value: string): MessageKey | null {
  const length = value.trim().length;
  if (length === 0) return 'form.name_required';
  return length > NAME_MAX_LENGTH ? 'form.name_too_long' : null;
}

export function validateTitle(value: string): MessageKey | null {
  const length = value.trim().length;
  if (length === 0) return 'form.title_required';
  return length > TITLE_MAX_LENGTH ? 'form.title_too_long' : null;
}

/**
 * city_id stays null until the catalog has seeded cities: campaigns.city_id is a foreign key to
 * catalog.cities, which no migration fills, so sending a map package's id would be rejected.
 */
export function newCampaign(name: string, rulesEdition: RulesEdition): NewCampaign {
  return { name: name.trim(), rules_edition: rulesEdition, city_id: null };
}
