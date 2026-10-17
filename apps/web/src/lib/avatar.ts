// Rond avec les initiales : palette, couleur par défaut, initiales.

// Palette fixe (users.avatar_color) : texte blanc lisible sur chaque couleur
// (contraste ≥ 4,5:1), en thème clair comme en thème sombre.
export const AVATAR_COLORS = {
  teal: { label: 'Sarcelle', hex: '#0f766e' },
  blue: { label: 'Bleu', hex: '#1d4ed8' },
  indigo: { label: 'Indigo', hex: '#4338ca' },
  violet: { label: 'Violet', hex: '#7c3aed' },
  pink: { label: 'Rose', hex: '#be185d' },
  red: { label: 'Rouge', hex: '#b91c1c' },
  orange: { label: 'Orange', hex: '#c2410c' },
  green: { label: 'Vert', hex: '#15803d' },
  slate: { label: 'Ardoise', hex: '#475569' },
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
