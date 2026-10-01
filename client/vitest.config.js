import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['client/src/**/*.test.{js,jsx}'],
    setupFiles: ['client/src/test-setup.js'],
    restoreMocks: true,
  },
});
