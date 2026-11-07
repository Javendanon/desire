// How far an interaction reaches. D09 has no sheet or encounter writes, so none reach the campaign.

export type InteractionScope = 'session' | 'device' | 'read-only';

export interface ScopeNoteText {
  label: string;
  text: string;
}

const SCOPE_NOTES: Record<InteractionScope, ScopeNoteText> = {
  session: {
    label: 'Local only',
    text: 'Not saved: lost on reload, never shared with the table or sent to Nivel20.',
  },
  device: {
    label: 'This device',
    text: 'Saved in this browser only, not shared with the table.',
  },
  'read-only': {
    label: 'Read-only',
    text: 'Nothing here can change the recorded sheet or Nivel20.',
  },
};

export function scopeNote(scope: InteractionScope): ScopeNoteText {
  return SCOPE_NOTES[scope];
}
