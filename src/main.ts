import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('root');
if (!target) throw new Error('Falta el punto de montaje de Desire.');

mount(App, { target });
