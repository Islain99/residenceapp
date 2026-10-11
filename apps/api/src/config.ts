// Configuration lue dans l'environnement (et dans .env s'il existe),
// validée au démarrage : une valeur manquante arrête l'API tout de suite.
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

const ConfigSchema = Type.Object({
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('test'), Type.Literal('production')],
    { default: 'development' },
  ),
  HOST: Type.String({ default: '127.0.0.1' }),   // 0.0.0.0 sur un hébergeur (Railway, AWS)
  // Nombre de proxys de confiance devant l'API, pour lire la vraie adresse IP
  // du client (X-Forwarded-For) : limites de connexion et journal d'audit.
  // 0 en local ; Vercel → Railway : 2. Trop élevé, un client pourrait falsifier son adresse.
  TRUST_PROXY: Type.Integer({ minimum: 0, maximum: 5, default: 0 }),
  PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 3000 }),
  DATABASE_URL: Type.String({ minLength: 1 }),
  // Secret de signature des jetons d'accès (HS256) : 32 caractères minimum
  JWT_SECRET: Type.String({ minLength: 32 }),
  ACCESS_TOKEN_TTL_MINUTES: Type.Integer({ minimum: 1, maximum: 60, default: 15 }),
  // Durée d'une session (jeton de rafraîchissement) : un quart de travail + marge.
  // Avec « appareil partagé », le cookie disparaît en plus à la fermeture du navigateur.
  REFRESH_TOKEN_TTL_HOURS: Type.Integer({ minimum: 1, maximum: 24 * 90, default: 12 }),
  // Requêtes de connexion par minute et par adresse IP. Large : tout le
  // personnel d'une résidence partage souvent la même adresse (Wi-Fi).
  LOGIN_RATE_LIMIT_MAX: Type.Integer({ minimum: 1, default: 30 }),
  // Blocage par compte : après LOGIN_MAX_ATTEMPTS mauvais mots de passe
  // d'affilée, le compte est bloqué LOGIN_LOCK_MINUTES, quelle que soit l'adresse IP.
  LOGIN_MAX_ATTEMPTS: Type.Integer({ minimum: 1, default: 5 }),
  LOGIN_LOCK_MINUTES: Type.Integer({ minimum: 1, default: 15 }),
  // Adresse de l'interface web : liens des courriels (invitation, mot de passe oublié)
  APP_URL: Type.String({ default: 'http://localhost:5173' }),
  // Serveur d'envoi des courriels. Développement : Mailpit (database/docker-compose.yml)
  SMTP_URL: Type.String({ default: 'smtp://127.0.0.1:1025' }),
  MAIL_FROM: Type.String({ default: 'Journal de bord <no-reply@residence.local>' }),
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
