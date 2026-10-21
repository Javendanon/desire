// Pure view models for the table UI: no DOM, no Svelte, no engine. Tested in tests/table-view.

import type { IconName } from './icons.ts';

export type Side = 'ally' | 'enemy';

export interface Combatant {
  id: string;
  name: string;
  fullName: string;
  role: string;
  side: Side;
  initiative: number;
  hp: number;
  maxHp: number;
  armorClass: number;
  condition: string;
}

export type Tone = 'narration' | 'voice' | 'success' | 'failure';

export interface StoryLine {
  speaker: string;
  text: string;
  tone: Tone;
}

export interface Choice {
  text: string;
  /** Skill check or condition shown after the choice, e.g. "[Investigación 13]". */
  tag?: string;
}

export interface TurnAction {
  id: string;
  label: string;
  icon?: IconName;
  primary?: boolean;
  unavailable?: boolean;
  /** Defined only for toggles such as "Moverse". */
  pressed?: boolean;
}

export interface Medal {
  id: string;
  name: string;
  initials: string;
  ringDash: string;
  ringColor: string;
  enemy: boolean;
  current: boolean;
  selected: boolean;
  caption: string;
  label: string;
}

/** Radius of the HP ring drawn inside a 64px medal. */
export const MEDAL_RING_RADIUS = 24;

const TONE_COLORS: Record<Tone, string> = {
  narration: 'var(--color-ash)',
  voice: 'var(--color-lantern)',
  success: 'var(--color-verdigris)',
  failure: 'var(--color-ember)',
};

export function hpRatio(c: Combatant): number {
  if (c.maxHp <= 0) return 0;
  return Math.min(1, Math.max(0, c.hp / c.maxHp));
}

/** SVG stroke-dasharray that fills the ring in proportion to the remaining HP. */
export function ringDash(ratio: number, radius: number = MEDAL_RING_RADIUS): string {
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(1, Math.max(0, ratio)) * circumference;
  return `${filled.toFixed(1)} ${circumference.toFixed(1)}`;
}

export function initials(name: string): string {
  const letters = name.trim().slice(0, 2);
  return letters.charAt(0).toUpperCase() + letters.slice(1);
}

export function sideColor(side: Side): string {
  return side === 'enemy' ? 'var(--color-ember)' : 'var(--color-verdigris)';
}

export function toneColor(tone: Tone): string {
  return TONE_COLORS[tone];
}

/** Screen-reader label: side and turn are spoken, never conveyed by colour alone. */
export function medalLabel(c: Combatant, current: boolean): string {
  const side = c.side === 'enemy' ? 'enemigo' : 'aliado';
  const turn = current ? ', su turno' : '';
  const hp = `${c.hp} de ${c.maxHp} puntos de vida`;
  return `${c.fullName}, ${side}, iniciativa ${c.initiative}, ${hp}${turn}`;
}

export function toMedal(c: Combatant, currentId: string, selectedId: string): Medal {
  const current = c.id === currentId;
  return {
    id: c.id,
    name: c.name,
    initials: initials(c.name),
    ringDash: ringDash(hpRatio(c)),
    ringColor: sideColor(c.side),
    enemy: c.side === 'enemy',
    current,
    selected: c.id === selectedId,
    caption: `${c.initiative} · ${c.hp}/${c.maxHp}`,
    label: medalLabel(c, current),
  };
}

/** Initiative order, highest first. Ties keep their original order. */
export function initiativeOrder(list: readonly Combatant[]): Combatant[] {
  return list
    .map((c, index) => ({ c, index }))
    .sort((a, b) => b.c.initiative - a.c.initiative || a.index - b.index)
    .map(({ c }) => c);
}

export function hpPercent(c: Combatant): string {
  return `${Math.round(hpRatio(c) * 100)}%`;
}

export function statLine(c: Combatant): string {
  const condition = c.condition ? ` · ${c.condition}` : '';
  return `${c.hp}/${c.maxHp} PV · CA ${c.armorClass}${condition}`;
}
