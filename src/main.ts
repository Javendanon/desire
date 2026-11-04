import { mount } from 'svelte';

import './lib/design/tokens.css';
import './lib/design/fonts.css';
import './lib/design/base.css';
import './app/shell.css';
import App from './App.svelte';

const target = document.getElementById('root');
if (!target) throw new Error('Desire mount point is missing.');

mount(App, { target });
