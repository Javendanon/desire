// Isolated design page (design.html): the table UI over a placeholder scene. Not the app entry.
import { mount } from 'svelte';

import '../lib/design/tokens.css';
import '../lib/design/fonts.css';
import '../lib/design/base.css';
import TableDemo from './TableDemo.svelte';

const target = document.getElementById('table');
if (!target) throw new Error('Missing #table mount point for the design page.');

mount(TableDemo, { target });
