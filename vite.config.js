import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    watch: { ignored: ['**/.smoke/**', '**/dist/**'] }
  },
  build: { target: 'es2022' }
});
