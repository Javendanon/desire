// Beats of the optional campaign prologue. Copy lives in the Spanish message catalog as data;
// this module only pairs a catalog key with an illustration and its framing.
import type { MessageKey } from '../../app/messages.ts';

/** One scene of the entry sequence: where to point the existing illustration, and its copy. */
export interface PrologueSection {
  id: string;
  still: string;
  focus: string;
  eyebrow: MessageKey;
  title: MessageKey;
  body: MessageKey;
}

// One illustration, three framings: the scroll drifts across it instead of loading paid footage.
export const PROLOGUE_SECTIONS: readonly PrologueSection[] = [
  {
    id: 'road',
    still: '/assets/abbey.jpg',
    focus: '34% 46%',
    eyebrow: 'prologue.road.eyebrow',
    title: 'prologue.road.title',
    body: 'prologue.road.body',
  },
  {
    id: 'gate',
    still: '/assets/abbey.jpg',
    focus: '62% 34%',
    eyebrow: 'prologue.gate.eyebrow',
    title: 'prologue.gate.title',
    body: 'prologue.gate.body',
  },
  {
    id: 'table',
    still: '/assets/abbey.jpg',
    focus: '58% 62%',
    eyebrow: 'prologue.table.eyebrow',
    title: 'prologue.table.title',
    body: 'prologue.table.body',
  },
];
