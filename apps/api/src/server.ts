import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/index.js';

const config = loadConfig();
const app = await buildApp(config, createDb(config.DATABASE_URL));

// Arrêt propre : termine les requêtes en cours, ferme les connexions
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'arrêt');
    app.close().then(() => process.exit(0), () => process.exit(1));
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
