// Configuration lue dans l'environnement (et dans .env s'il existe),
// validée au démarrage : une valeur manquante arrête l'API tout de suite.
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

const ConfigSchema = Type.Object({
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('test'), Type.Literal('production')],
    { default: 'development' },
  ),
  HOST: Type.String({ default: '127.0.0.1' }),
  PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 3000 }),
  DATABASE_URL: Type.String({ minLength: 1 }),
  // Secret de signature des jetons d'accès (HS256) : 32 caractères minimum
  JWT_SECRET: Type.String({ minLength: 32 }),
  ACCESS_TOKEN_TTL_MINUTES: Type.Integer({ minimum: 1, maximum: 60, default: 15 }),
  REFRESH_TOKEN_TTL_DAYS: Type.Integer({ minimum: 1, maximum: 90, default: 30 }),
  // Tentatives de connexion par minute et par adresse IP
  LOGIN_RATE_LIMIT_MAX: Type.Integer({ minimum: 1, default: 10 }),
});

export type Config = Static<typeof ConfigSchema>;

export function loadConfig(overrides: Partial<Record<keyof Config, unknown>> = {}): Config {
  try {
    process.loadEnvFile();   // .env du dossier courant ; n'écrase pas les variables déjà définies
  } catch {
    // pas de .env : on utilise seulement l'environnement
  }
  let value: unknown = Value.Default(ConfigSchema, { ...process.env, ...overrides });
  value = Value.Clean(ConfigSchema, Value.Convert(ConfigSchema, value));
  if (!Value.Check(ConfigSchema, value)) {
    const errors = [...Value.Errors(ConfigSchema, value)]
      .map((e) => `  ${e.instancePath.slice(1) || '(racine)'} : ${e.message}`);
    throw new Error(`Configuration invalide :\n${[...new Set(errors)].join('\n')}`);
  }
  return value;
}
