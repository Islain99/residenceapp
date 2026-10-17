// Dessin des avatars illustrés (DiceBear, styles Lorelei et Notionists :
// dessins sous licence CC0, code MIT). Fichier chargé à part (import() dans
// lib/avatar.ts) : ces dessins pèsent autant que le reste de l'application,
// ils ne retardent pas le premier affichage.
import { createAvatar, type Style } from '@dicebear/core';
import * as lorelei from '@dicebear/lorelei';
import * as notionists from '@dicebear/notionists';

// Options communes seulement (seed, fond, arrondi) : un type commun suffit
const STYLES: Record<string, Style<object>> = { lorelei, notionists };

// SVG en data: URI ; null si le style est inconnu
export function drawAvatar(style: string, seed: string, backgroundHex: string): string | null {
  const art = STYLES[style];
  if (!art) return null;
  return createAvatar(art, { seed, backgroundColor: [backgroundHex.replace('#', '')], radius: 50 }).toDataUri();
}
