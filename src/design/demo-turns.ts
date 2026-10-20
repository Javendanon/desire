// A scripted stand-in for combat on the design page: fixed effects, no dice. The real rules
// (attacks, healing, conditions) belong to D16; this only drives the UI and the miniatures.

import type { Combatant, StoryLine } from '../lib/ui/table-view.ts';

export const DEMO_DAMAGE = 4;
export const DEMO_HEALING = 5;

export interface TurnResult {
  combatants: Combatant[];
  line: StoryLine;
}

function update(
  list: readonly Combatant[],
  id: string,
  change: (c: Combatant) => Partial<Combatant>,
) {
  return list.map((c) => (c.id === id ? { ...c, ...change(c) } : c));
}

export function strike(
  list: readonly Combatant[],
  attacker: Combatant,
  target: Combatant,
): TurnResult {
  const hp = Math.max(0, target.hp - DEMO_DAMAGE);
  const condition = hp === 0 ? 'Caída' : target.condition;
  return {
    combatants: update(list, target.id, () => ({ hp, condition })),
    line: {
      speaker: attacker.name,
      text: `${DEMO_DAMAGE} de daño a ${target.fullName}.`,
      tone: 'success',
    },
  };
}

export function heal(list: readonly Combatant[], healer: Combatant, target: Combatant): TurnResult {
  const hp = Math.min(target.maxHp, target.hp + DEMO_HEALING);
  const condition = target.condition === 'Caída' ? '' : target.condition;
  return {
    combatants: update(list, target.id, () => ({ hp, condition })),
    line: {
      speaker: `${healer.name} · Palabra de curación`,
      text: `${target.fullName} recupera ${DEMO_HEALING} PV.`,
      tone: 'success',
    },
  };
}

/** First ally still standing: the target an enemy walks toward on the demo page. */
export function nearestStandingAlly(list: readonly Combatant[]): Combatant | undefined {
  return list.find((c) => c.side === 'ally' && c.hp > 0);
}

export function isDown(c: Combatant): boolean {
  return c.hp <= 0;
}
