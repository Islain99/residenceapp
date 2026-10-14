// Double authentification : codes à usage temporaire (TOTP, RFC 6238 —
// 6 chiffres, pas de 30 s, HMAC-SHA1, compatible avec Google Authenticator,
// Microsoft Authenticator, 1Password…) et codes de secours.
//
// Le secret est chiffré en base (AES-256-GCM) : une copie de la base ne
// suffit pas pour générer des codes.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.js';

const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1;            // un pas avant / après : décalage d'horloge du téléphone

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('base32 invalide');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateSecret = () => base32Encode(randomBytes(20));

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

export function totp(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

// Pas de 30 s du code s'il est valable (et plus récent que le dernier accepté :
// un code déjà utilisé ne sert pas deux fois), sinon null
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const step = currentStep(now);
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    const s = step + delta;
    if (lastStep !== null && s <= lastStep) continue;
    const expected = Buffer.from(totp(secret, s));
    if (timingSafeEqual(expected, Buffer.from(clean))) return s;
  }
  return null;
}

export function otpauthUrl(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------- Chiffrement

function key(config: Config): Buffer {
  return createHash('sha256').update(config.MFA_ENCRYPTION_KEY ?? `mfa:${config.JWT_SECRET}`).digest();
}

export function encryptSecret(config: Config, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(config), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(config: Config, stored: string): string {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('secret illisible');
  const decipher = createDecipheriv('aes-256-gcm', key(config), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

// ----------------------------------------------------------- Codes de secours

const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';   // sans 0/o, 1/l/i
export const BACKUP_CODE_COUNT = 10;

export function generateBackupCodes(): string[] {
  const one = () => Array.from({ length: 8 }, () => BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)]).join('');
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const c = one();
    return `${c.slice(0, 4)}-${c.slice(4)}`;
  });
}

// Tirets, espaces et majuscules ignorés
export const normalizeBackupCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');
export const hashBackupCode = (code: string) => createHash('sha256').update(normalizeBackupCode(code)).digest('hex');
export const looksLikeBackupCode = (code: string) => normalizeBackupCode(code).length === 8 && !/^\d+$/.test(normalizeBackupCode(code));
