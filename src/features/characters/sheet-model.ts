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

export function hasSheetData(sheet: ActorSheet): boolean {
  return sheet.stats !== null || sheet.state !== null || sheet.details !== null;
}
