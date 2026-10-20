// Demo content for the isolated design page. Original text written for card D03; not rules data.

import type { Choice, Combatant, StoryLine } from '../lib/ui/table-view.ts';

export const ZOOM_LEVELS = ['Ciudad', 'Barrio', 'Escena'] as const;

export interface Place {
  kicker: string;
  name: string;
  text: string;
}

export const CITY_HINT: Place = {
  kicker: 'Waterdeep',
  name: 'Elige un barrio',
  text: 'Rueda o pellizca para acercarte. Arrastra para girar la ciudad.',
};

export const HARBOR: Place = {
  kicker: 'Muelles, grúas y almacenes',
  name: 'Puerto Profundo',
  text: 'Aquí llega casi todo el grano del norte, y casi todo lo que nadie declara.',
};

export const OPENING: readonly StoryLine[] = [
  {
    speaker: 'Narrador',
    text:
      'La niebla sube del agua y se pega a las grúas. En el muelle siete, una está partida en dos.',
    tone: 'narration',
  },
  {
    speaker: 'Oslo, estibador',
    text: '«La grúa no se cayó sola. Alguien cortó el cable antes de que llegara la carga.»',
    tone: 'voice',
  },
  {
    speaker: 'Percepción · Desafiante 12',
    text: 'Éxito (15). Hay sal fresca en el corte: lo hicieron hace menos de una hora.',
    tone: 'success',
  },
];

export interface DemoChoice extends Choice {
  reply: StoryLine;
  startsCombat?: boolean;
}

export const CHOICES: readonly DemoChoice[] = [
  {
    text: '«¿Quién estaba de guardia esta noche?»',
    reply: {
      speaker: 'Oslo, estibador',
      text: '«El turno era de los Mano Gris. Pero esta noche no vino nadie.»',
      tone: 'voice',
    },
  },
  {
    text: 'Revisar las cajas sin marca.',
    tag: '[Investigación 13]',
    reply: {
      speaker: 'Investigación · 13',
      text: 'Fallo (9). Clavos de cobre y un sello que no reconoces.',
      tone: 'failure',
    },
  },
  {
    text: 'Mirar hacia los barriles.',
    startsCombat: true,
    reply: {
      speaker: 'Narrador',
      text:
        'Detrás de los barriles, un matón de Xanathar sonríe. Algo grande se mueve bajo el muelle.',
      tone: 'narration',
    },
  },
];

export const COMBATANTS: readonly Combatant[] = [
  {
    id: 'aubrey', name: 'Aubrey', fullName: 'Aubrey Valcourt', role: 'Exploradora', side: 'ally',
    initiative: 18, hp: 22, maxHp: 26, armorClass: 16, condition: 'Concentrada',
  },
  {
    id: 'celeste', name: 'Celeste', fullName: 'Celeste Marwyn', role: 'Maga', side: 'ally',
    initiative: 16, hp: 0, maxHp: 20, armorClass: 12, condition: 'Caída',
  },
  {
    id: 'sera', name: 'Sera', fullName: 'Sera Dunmore', role: 'Clériga', side: 'ally',
    initiative: 14, hp: 19, maxHp: 24, armorClass: 18, condition: '',
  },
  {
    id: 'thug', name: 'Matón', fullName: 'Matón de Xanathar', role: 'Hostil', side: 'enemy',
    initiative: 12, hp: 11, maxHp: 16, armorClass: 13, condition: 'Herido',
  },
  {
    id: 'crab', name: 'Cangrejo', fullName: 'Cangrejo gigante', role: 'Hostil', side: 'enemy',
    initiative: 9, hp: 7, maxHp: 7, armorClass: 15, condition: '',
  },
];
