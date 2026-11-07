import { mount } from 'svelte';

import './lib/design/tokens.css';
import './lib/design/fonts.css';
import './lib/design/base.css';
import './app/shell.css';
import { CAMPAIGN_HUB, CAMPAIGN_PROLOGUE, flagsFromPage } from './app/flags.ts';
import LegacyShell from './app/LegacyShell.svelte';
import App from './App.svelte';

const target = document.getElementById('root');
if (!target) throw new Error('Desire mount point is missing.');

// Off by default: without the flag the app is the page it was before the hub (docs/flags.md).
const flags = flagsFromPage();
if (flags.has(CAMPAIGN_HUB)) {
  mount(App, { target, props: { prologue: flags.has(CAMPAIGN_PROLOGUE) } });
} else {
  mount(LegacyShell, { target });
}
