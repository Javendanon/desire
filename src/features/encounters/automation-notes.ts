// What the panel tells the table about its own limits: everything it computes, and what it leaves.

/** Shown beside the panel: the complete list of what it computes for the table. */
export const AUTOMATED_RULES: readonly string[] = [
  'Ability modifiers: (score − 10) ÷ 2, rounded down.',
  'Total level: the sum of class levels.',
  'Turn order: highest initiative first, ties keep their recorded order.',
  'Turns: a participant with no initiative set takes no turn.',
  'Rounds: the counter rises when the turn order wraps.',
  'Durations: each timed condition loses one round when the round rises.',
  'Expiry: a timed condition whose last round elapses is withdrawn, for this session only.',
  'HP edits: the value stays between 0 and the recorded maximum.',
];

export const NOT_AUTOMATED: readonly string[] = [
  'Dice rolls and saving throws, including concentration checks.',
  'Damage, temporary HP, death and unconsciousness.',
  'Ending a condition early, or one with no fixed duration recorded.',
  'Spell preparation, and any change on Nivel20.',
];
