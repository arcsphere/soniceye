import { defineConfig } from 'vite';

// Production builds are served from musiciate.com/soniceye/; the dev server stays at /.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/soniceye/' : '/',
}));
