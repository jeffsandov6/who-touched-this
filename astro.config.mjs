import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import solid from '@astrojs/solid-js';
import svelte from '@astrojs/svelte';
import vue from '@astrojs/vue';

export default defineConfig({
  output: 'static',
  integrations: [
    react({
      include: [
        '**/src/platform/**/*.tsx',
        '**/src/canvas/pages/**/*.tsx',
        '**/src/canvas/components/react/**/*.{jsx,tsx}',
      ],
    }),
    solid({ include: ['**/src/canvas/components/solid/**/*.{jsx,tsx}'] }),
    vue(),
    svelte(),
  ],
});
