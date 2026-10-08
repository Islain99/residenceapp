import { createHash, randomBytes } from 'node:crypto';

// Jeton de rafraîchissement : 256 bits aléatoires, remis une seule fois au client.
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

// Seul le SHA-256 est stocké (refresh_tokens.token_hash), jamais le jeton.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
