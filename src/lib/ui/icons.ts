// Stroke icons drawn on an 18×18 grid. Decorative: the control around them carries the label.

export const ICON_PATHS = {
  move: 'M9 2v14M2 9h14M9 2 6.5 4.5M9 2l2.5 2.5M9 16l-2.5-2.5M9 16l2.5-2.5',
  attack: 'M3 15 13 5m0 0V2h3v3h-3M5 11l2 2M2 16l2-2',
  heal: 'M9 4.5v9M4.5 9h9M9 1.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15z',
  dodge: 'M9 2 15 4.5V9c0 3.5-2.6 5.8-6 7-3.4-1.2-6-3.5-6-7V4.5z',
  search: 'M8 3a5 5 0 1 1 0 10A5 5 0 0 1 8 3zm3.6 8.6L15.5 15.5',
  plus: 'M9 3.5v11M3.5 9h11',
  minus: 'M3.5 9h11',
} as const;

export type IconName = keyof typeof ICON_PATHS;
