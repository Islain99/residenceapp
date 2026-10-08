import { hash, verify } from '@node-rs/argon2';

// Argon2id, paramètres minimaux recommandés par l'OWASP (19 Mio, 2 passes)
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

// Faux si le hachage est invalide (ex. « !seed » des données fictives)
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Hachage factice : un courriel inconnu coûte le même temps qu'un mauvais
// mot de passe, pour ne pas révéler quels comptes existent.
let dummyHash: Promise<string> | undefined;
export async function burnVerifyTime(password: string): Promise<void> {
  dummyHash ??= hashPassword('mot-de-passe-factice');
  await verifyPassword(await dummyHash, password);
}
