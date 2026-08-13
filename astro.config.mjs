// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
    server: {
      // Astro's dev server is Vite underneath, and Vite rejects Host headers it
      // doesn't recognise. The leading dot allows any *.ngrok-free.app subdomain,
      // so a rotated tunnel hostname doesn't need a config edit. Dev only.
      allowedHosts: ['.ngrok-free.app'],
    },
  },
});
