import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('root');
if (!target) throw new Error('Desire mount point is missing.');

mount(App, { target });
