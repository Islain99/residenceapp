import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Base « residence_test » recréée avant chaque exécution
    globalSetup: ['test/global-setup.ts'],
    // Tests d'intégration sur cette base : un fichier à la fois
    fileParallelism: false,
    testTimeout: 15000,
  },
});
