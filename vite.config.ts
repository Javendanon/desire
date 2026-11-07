import { readFileSync } from 'node:fs';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';

const FLAGS_FILE_ENV = 'DESIRE_FLAGS_FILE';
const FLAGS_META = 'desire-flags';

/** The flags file text, read per page request so an edit applies on the next reload. */
function flagsText(): string {
  const path = process.env[FLAGS_FILE_ENV];
  if (!path) return '';
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    console.warn(`flags: ${path} is unreadable; using the default (every flag off)`, error);
    return '';
  }
}

/** Hands the same flags file `desire_core::flags` reads to the browser, as one meta tag. */
function desireFlags(): Plugin {
  return {
    name: 'desire-flags',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { name: FLAGS_META, content: flagsText() }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig({
  plugins: [desireFlags(), svelte()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
