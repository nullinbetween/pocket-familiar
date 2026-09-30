import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {INTENDED_PROJECT_ID} from './server/config';

export default defineConfig(({ command, mode }) => {
  // Round 1.1 fix 2: a production build FAILS when the intended-project
  // configuration is incomplete. A missing env value must never produce a
  // successful-looking build bound to an unreviewed project.
  if (command === 'build' && mode === 'production') {
    const required = [
      'VITE_FIREBASE_PROJECT_ID',
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_AUTH_DOMAIN',
      'VITE_FIREBASE_APP_ID',
    ];
    const missing = required.filter((k) => !process.env[k]?.trim());
    if (missing.length > 0) {
      throw new Error(
        `[build] Refusing production build: missing ${missing.join(', ')}. ` +
          `Provide the reviewed submission project (${INTENDED_PROJECT_ID}) configuration.`
      );
    }
    // Round 1.2 fix 1: completeness is not acceptance — the production build
    // binds EXACTLY the reviewed submission project; every other id is refused.
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID?.trim();
    if (projectId && projectId !== INTENDED_PROJECT_ID) {
      throw new Error(
        `[build] Refusing production build: VITE_FIREBASE_PROJECT_ID "${projectId}" is not the ` +
          `reviewed submission project "${INTENDED_PROJECT_ID}".`
      );
    }
  }
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
