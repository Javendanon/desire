// Synthetic demo sheets, plus the one real name known so far. No real statistics live here.

import type {
  AbilityScores,
  Actor,
  ActorStats,
  Id,
  Provenance,
  RulesEdition,
} from '../../generated/contracts.ts';
import type { RuleEntry } from './rule-book.ts';
import { identityOnlySheet, type ActorSheet } from './sheet-model.ts';

export const DEMO_RULES_EDITION: RulesEdition = 'dnd_2014';
export const DEMO_CAMPAIGN_ID = '00000000-0000-4000-8000-000000000d16';

/** Compendium entries for the 2014 edition: content/knowledge/compendium.json. */
const WIZARD_ENTRY = 'c4effe1d-c5ee-567e-bccf-3bc068f76c30';
const PRONE_ENTRY = '895aa639-5a48-58f8-9ab8-9d0e83391086';
const FIREBALL_ENTRY = '140fec29-95f8-5b36-8ed5-f58d6f40e190';

const VEIL_ENTRY = '00000000-0000-4000-8000-00000000d101';
const MARKED_ENTRY = '00000000-0000-4000-8000-00000000d102';
const WARDEN_ENTRY = '00000000-0000-4000-8000-00000000d103';

const WARDEN_ID = '00000000-0000-4000-8000-00000000d201';
const MAGE_ID = '00000000-0000-4000-8000-00000000d202';
const BRUTE_ID = '00000000-0000-4000-8000-00000000d203';
const BRUTE_TEMPLATE_ID = '00000000-0000-4000-8000-00000000d301';
const IONYTH_ID = '00000000-0000-4000-8000-00000000d204';

const DEMO_SPEED_M = 9;

export const DEMO_PROVENANCE: Provenance = {
  source: 'fixture:d16-demo',
  attribution: 'Synthetic example written for D16',
  evidence: 'synthetic',
};

function demoRule(id: Id, kind: string, title: string): RuleEntry {
  return {
    id,
    revision: 1,
    rules_edition: DEMO_RULES_EDITION,
    language: 'en',
    title,
    body: `Synthetic ${kind} for the demo. It is not a rule from any published source.`,
    provenance: DEMO_PROVENANCE,
    kind,
    sourceLocator: null,
    verification: 'pending_review',
  };
}

/** The compendium has no concentration spell or timed condition yet, so the demo adds its own. */
export const DEMO_RULE_ENTRIES: readonly RuleEntry[] = [
  demoRule(VEIL_ENTRY, 'spell', 'Demo Veil'),
  demoRule(MARKED_ENTRY, 'condition', 'Demo Mark'),
  demoRule(WARDEN_ENTRY, 'class', 'Demo Warden'),
];

interface ActorSeed {
  id: Id;
  name: string;
  kind: Actor['kind'];
  disposition: Actor['disposition'];
  templateId?: Id;
}

function demoActor(seed: ActorSeed): Actor {
  return {
    id: seed.id,
    campaign_id: DEMO_CAMPAIGN_ID,
    rules_edition: DEMO_RULES_EDITION,
    character_id: seed.kind === 'character' ? seed.id : null,
    template_id: seed.templateId ?? null,
    kind: seed.kind,
    name: seed.name,
    visibility: 'players',
    disposition: seed.disposition,
    revision: 1,
  };
}

function owned(actorId: Id) {
  return { campaign_id: DEMO_CAMPAIGN_ID, actor_id: actorId };
}

function ruled(actorId: Id) {
  return { ...owned(actorId), rules_edition: DEMO_RULES_EDITION };
}

interface ConditionSeed {
  id: Id;
  actorId: Id;
  entry: Id;
  remainingRounds: number | null;
}

function demoCondition(seed: ConditionSeed) {
  return {
    ...ruled(seed.actorId),
    id: seed.id,
    knowledge_entry_id: seed.entry,
    remaining_rounds: seed.remainingRounds,
    revision: 1,
  };
}

const MAGE_PRONE: ConditionSeed = {
  id: '00000000-0000-4000-8000-00000000d701',
  actorId: MAGE_ID,
  entry: PRONE_ENTRY,
  remainingRounds: null,
};

const BRUTE_MARKED: ConditionSeed = {
  id: '00000000-0000-4000-8000-00000000d702',
  actorId: BRUTE_ID,
  entry: MARKED_ENTRY,
  remainingRounds: 2,
};

const BRUTE_PRONE: ConditionSeed = {
  id: '00000000-0000-4000-8000-00000000d703',
  actorId: BRUTE_ID,
  entry: PRONE_ENTRY,
  remainingRounds: null,
};

const BRUTE_ACTOR: ActorSeed = {
  id: BRUTE_ID,
  name: 'Demo Brute',
  kind: 'monster',
  disposition: 'hostile',
  templateId: BRUTE_TEMPLATE_ID,
};

function demoStats(actorId: Id, abilities: AbilityScores, armorClass: number): ActorStats {
  return {
    ...owned(actorId),
    abilities,
    armor_class: armorClass,
    speed_m: DEMO_SPEED_M,
    revision: 1,
  };
}

function demoState(actorId: Id, currentHp: number, maxHp: number) {
  return {
    ...owned(actorId),
    max_hp: maxHp,
    current_hp: currentHp,
    temporary_hp: 0,
    status: 'active' as const,
    revision: 1,
  };
}

const WARDEN_SHEET: ActorSheet = {
  ...identityOnlySheet(
    demoActor({ id: WARDEN_ID, name: 'Demo Warden', kind: 'character', disposition: 'friendly' }),
    DEMO_PROVENANCE,
  ),
  stats: demoStats(
    WARDEN_ID,
    { strength: 12, dexterity: 16, constitution: 14, intelligence: 10, wisdom: 15, charisma: 8 },
    15,
  ),
  state: { ...demoState(WARDEN_ID, 22, 26), temporary_hp: 4 },
  details: {
    ...owned(WARDEN_ID),
    ancestry: 'Demo ancestry',
    background: 'Demo background',
    experience: 900,
    biography: 'A placeholder written to show the layout of a complete sheet.',
    revision: 1,
  },
  classes: [
    {
      ...ruled(WARDEN_ID),
      class_entry_id: WARDEN_ENTRY,
      level: 3,
      subclass_entry_id: null,
      hit_die: 10,
    },
  ],
  proficiencies: [
    { ...owned(WARDEN_ID), category: 'skill', name: 'Survival', training: 'proficient' },
    { ...owned(WARDEN_ID), category: 'saving_throw', name: 'Dexterity', training: 'proficient' },
  ],
  equipment: [
    {
      ...owned(WARDEN_ID),
      id: '00000000-0000-4000-8000-00000000d401',
      name: 'Demo longbow',
      quantity: 1,
      equipped: true,
      attuned: false,
      description: 'Placeholder equipment.',
      revision: 1,
    },
    {
      ...owned(WARDEN_ID),
      id: '00000000-0000-4000-8000-00000000d402',
      name: 'Demo arrows',
      quantity: 20,
      equipped: false,
      attuned: false,
      description: 'Placeholder equipment.',
      revision: 1,
    },
  ],
  spells: [{ ...ruled(WARDEN_ID), knowledge_entry_id: VEIL_ENTRY, prepared: true }],
  resources: [
    {
      ...owned(WARDEN_ID),
      name: 'Demo focus',
      maximum: 3,
      remaining: 2,
      recovery: 'long_rest',
      revision: 1,
    },
  ],
  concentration: { ...ruled(WARDEN_ID), knowledge_entry_id: VEIL_ENTRY, revision: 1 },
};

const MAGE_SHEET: ActorSheet = {
  ...identityOnlySheet(
    demoActor({ id: MAGE_ID, name: 'Demo Mage', kind: 'character', disposition: 'friendly' }),
    DEMO_PROVENANCE,
  ),
  stats: demoStats(
    MAGE_ID,
    { strength: 8, dexterity: 14, constitution: 12, intelligence: 17, wisdom: 11, charisma: 10 },
    12,
  ),
  state: demoState(MAGE_ID, 0, 20),
  classes: [
    {
      ...ruled(MAGE_ID),
      class_entry_id: WIZARD_ENTRY,
      level: 5,
      subclass_entry_id: null,
      hit_die: 6,
    },
  ],
  spells: [{ ...ruled(MAGE_ID), knowledge_entry_id: FIREBALL_ENTRY, prepared: false }],
  conditions: [demoCondition(MAGE_PRONE)],
};

const BRUTE_SHEET: ActorSheet = {
  ...identityOnlySheet(demoActor(BRUTE_ACTOR), DEMO_PROVENANCE),
  stats: demoStats(
    BRUTE_ID,
    { strength: 15, dexterity: 11, constitution: 13, intelligence: 9, wisdom: 10, charisma: 7 },
    13,
  ),
  state: demoState(BRUTE_ID, 11, 16),
  actions: [
    {
      id: '00000000-0000-4000-8000-00000000d501',
      template_id: BRUTE_TEMPLATE_ID,
      name: 'Demo club',
      kind: 'action',
      description: 'Placeholder action text, with no numbers to roll.',
    },
    {
      id: '00000000-0000-4000-8000-00000000d502',
      template_id: BRUTE_TEMPLATE_ID,
      name: 'Demo shove',
      kind: 'reaction',
      description: 'Placeholder reaction text, with no numbers to roll.',
    },
  ],
  conditions: [demoCondition(BRUTE_MARKED), demoCondition(BRUTE_PRONE)],
};

export const DEMO_SHEETS: readonly ActorSheet[] = [WARDEN_SHEET, MAGE_SHEET, BRUTE_SHEET];

/**
 * Only the name is confirmed (docs/nivel20-api.md, read-only evidence). Contract fields without
 * a default take neutral values, and the sheet view does not present them as confirmed.
 */
export const IONYTH_SHEET: ActorSheet = identityOnlySheet(
  demoActor({ id: IONYTH_ID, name: 'Ionyth', kind: 'character', disposition: 'neutral' }),
  {
    source: 'docs/nivel20-api.md',
    attribution: 'Character name observed read-only on Nivel20',
    evidence: 'verified',
  },
);
