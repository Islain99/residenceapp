// Avatar d'une personne : illustration choisie dans la galerie, sinon ses
// initiales. Couleur du fond choisie dans le profil, sinon tirée de son id.
//
// Les illustrations sont dessinées dans le navigateur (lib/avatar-art.ts,
// chargé à part) : aucune image n'est téléversée ni stockée, la base ne
// garde que « style:nom » (users.avatar).

// Palette fixe (users.avatar_color).
//   hex  : fond du rond avec les initiales (texte blanc lisible, contraste ≥ 4,5:1)
//   soft : fond clair derrière une illustration (traits foncés bien visibles)
export const AVATAR_COLORS = {
  // (noms des couleurs : i18n, account.avatar.colors)
  teal: { hex: '#0f766e', soft: '#ccfbf1' },
  blue: { hex: '#1d4ed8', soft: '#dbeafe' },
  indigo: { hex: '#4338ca', soft: '#e0e7ff' },
  violet: { hex: '#7c3aed', soft: '#ede9fe' },
  pink: { hex: '#be185d', soft: '#fce7f3' },
  red: { hex: '#b91c1c', soft: '#fee2e2' },
  orange: { hex: '#c2410c', soft: '#ffedd5' },
  green: { hex: '#15803d', soft: '#dcfce7' },
  slate: { hex: '#475569', soft: '#e2e8f0' },
} as const;
export type AvatarColor = keyof typeof AVATAR_COLORS;
const NAMES = Object.keys(AVATAR_COLORS) as AvatarColor[];

// Sans couleur choisie : toujours la même pour une personne, tirée de son id
export function defaultAvatarColor(id: string): AvatarColor {
  let sum = 0;
  for (const char of id) sum = (sum * 31 + char.charCodeAt(0)) % 997;
  return NAMES[sum % NAMES.length]!;
}

// Couleur choisie si elle est connue, sinon celle tirée de l'id
export const avatarColorOf = (person: { id: string; avatarColor?: string | null }): AvatarColor =>
  person.avatarColor && person.avatarColor in AVATAR_COLORS ? person.avatarColor as AvatarColor : defaultAvatarColor(person.id);

// « Marie-Ève Gagnon » → « MG » ; « émile » → « É »
export function initials(firstName: string, lastName: string): string {
  const first = (word: string) => word.trim().charAt(0).toLocaleUpperCase('fr-CA');
  return `${first(firstName)}${first(lastName)}` || '?';
}

// ---------------------------------------------------------------------
// Galerie d'avatars illustrés
// ---------------------------------------------------------------------

type AvatarStyle = 'lorelei' | 'notionists';
const STYLES: AvatarStyle[] = ['lorelei', 'notionists'];   // libellés : i18n, account.avatar.styles

// Chaque nom donne toujours le même personnage. Mêmes règles que l'API :
// « style:nom », nom en minuscules sans accent.
const SEEDS = ['aurore', 'basile', 'chloe', 'denis', 'elise', 'felix', 'gaby', 'hugo', 'iris', 'jules', 'kim', 'leo'];
export const GALLERY: { style: AvatarStyle; ids: string[] }[] = STYLES
  .map((style) => ({ style, ids: SEEDS.map((seed) => `${style}:${seed}`) }));

// Images déjà dessinées (SVG en data: URI) : la barre du haut et les listes
// redessinent souvent les mêmes avatars. null : avatar inconnu → initiales.
const cache = new Map<string, string | null>();
export const avatarKey = (avatar: string, color: AvatarColor) => `${avatar}|${color}`;
export const cachedAvatarImage = (key: string) => cache.get(key);

// Dessine l'avatar, en chargeant d'abord les dessins (une fois)
export async function loadAvatarImage(avatar: string, color: AvatarColor): Promise<string | null> {
  const key = avatarKey(avatar, color);
  if (cache.has(key)) return cache.get(key) ?? null;
  const { drawAvatar } = await import('./avatar-art');
  const [style = '', seed = ''] = avatar.split(':');
  const uri = seed ? drawAvatar(style, seed, AVATAR_COLORS[color].soft) : null;
  cache.set(key, uri);
  return uri;
}
