// One actor's sheet as contract records. A part that was never supplied stays null or empty.

import type {
  Actor,
  ActorConcentration,
  ActorCondition,
  ActorResource,
  ActorState,
  ActorStats,
  CharacterClass,
  CharacterEquipment,
  CharacterProficiency,
  CharacterSheet,
  CharacterSpell,
  ClassFeature,
  CreatureAction,
  Evidence,
  Provenance,
} from '../../generated/contracts.ts';

export interface ActorSheet {
  actor: Actor;
  /** Where this bundle of records comes from: a demo fixture must say so. */
  provenance: Provenance;
  stats: ActorStats | null;
  state: ActorState | null;
  details: CharacterSheet | null;
  classes: readonly CharacterClass[];
  features: readonly ClassFeature[];
  proficiencies: readonly CharacterProficiency[];
  equipment: readonly CharacterEquipment[];
  spells: readonly CharacterSpell[];
  resources: readonly ActorResource[];
  /** The contract only records actions on creature templates, not on character sheets. */
  actions: readonly CreatureAction[];
  conditions: readonly ActorCondition[];
  concentration: ActorConcentration | null;
}

export interface EvidenceBadge {
  /** Text mark, so the meaning survives without colour. */
  glyph: string;
  label: string;
  detail: string;
}

const EVIDENCE_BADGES: Record<Evidence, EvidenceBadge> = {
  verified: { glyph: '✓', label: 'Confirmed', detail: 'Checked against the cited source.' },
  interpretation: {
    glyph: '≈',
    label: 'Interpreted',
    detail: 'Summarised from the cited source, not verbatim.',
  },
  synthetic: {
    glyph: '◇',
    label: 'Demo',
    detail: 'Invented example data, not a real character or rule.',
  },
};

export function evidenceBadge(evidence: Evidence): EvidenceBadge {
  return EVIDENCE_BADGES[evidence];
}

/** An actor whose identity is known but whose sheet nobody has supplied. */
export function identityOnlySheet(actor: Actor, provenance: Provenance): ActorSheet {
  return {
    actor,
    provenance,
    stats: null,
    state: null,
    details: null,
    classes: [],
    features: [],
    proficiencies: [],
    equipment: [],
    spells: [],
    resources: [],
    actions: [],
    conditions: [],
    concentration: null,
  };
}

/** True when any record beyond identity was supplied, so nothing the panel shows is hidden here. */
export function hasSheetData(sheet: ActorSheet): boolean {
  const records = [sheet.stats, sheet.state, sheet.details, sheet.concentration];
  const lists = [
    sheet.classes,
    sheet.features,
    sheet.proficiencies,
    sheet.equipment,
    sheet.spells,
    sheet.resources,
    sheet.actions,
    sheet.conditions,
  ];
  return records.some((record) => record !== null) || lists.some((list) => list.length > 0);
}

const IDENTITY_ONLY_DETAIL = 'The cited source confirms only the name; nothing else was supplied.';

/** The badge for a whole sheet: a confirmed identity must not read as a confirmed sheet. */
export function sheetBadge(sheet: ActorSheet): EvidenceBadge {
  const badge = evidenceBadge(sheet.provenance.evidence);
  return hasSheetData(sheet) ? badge : { ...badge, detail: IDENTITY_ONLY_DETAIL };
}
