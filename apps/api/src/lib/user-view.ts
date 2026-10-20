// L'utilisateur connecté tel que renvoyé au client (connexion, /auth/me, profil).
import { Type } from '@fastify/type-provider-typebox';

// Couleurs possibles du rond avec les initiales (users.avatar_color, 0012)
export const AVATAR_COLORS = ['teal', 'blue', 'indigo', 'violet', 'pink', 'red', 'orange', 'green', 'slate'] as const;
export const AvatarColor = Type.Union(AVATAR_COLORS.map((c) => Type.Literal(c)));

// Avatar illustré de la galerie, « style:nom » (users.avatar, 0012). L'interface
// le dessine (DiceBear) ; l'API ne fait que vérifier la forme.
export const Avatar = Type.String({ pattern: '^(lorelei|notionists):[a-z]{2,20}$' });

export const UserBody = Type.Object({
  id: Type.String(),
  email: Type.String(),
  firstName: Type.String(),
  lastName: Type.String(),
  role: Type.String(),
  residenceId: Type.Union([Type.String(), Type.Null()]),
  phone: Type.Union([Type.String(), Type.Null()]),
  avatar: Type.Union([Type.String(), Type.Null()]),        // null : initiales
  avatarColor: Type.Union([Type.String(), Type.Null()]),   // null : couleur choisie d'après l'id
  locale: Type.String(),                                   // fr | en : interface, courriels, notifications
});

export const USER_COLUMNS = ['id', 'email', 'first_name', 'last_name', 'role', 'residence_id', 'phone', 'avatar',
  'avatar_color', 'locale'] as const;

export function toUserBody(user: {
  id: string; email: string; first_name: string; last_name: string; role: string;
  residence_id: string | null; phone: string | null; avatar: string | null; avatar_color: string | null; locale: string;
}) {
  return {
    id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name,
    role: user.role, residenceId: user.residence_id, phone: user.phone, avatar: user.avatar, avatarColor: user.avatar_color,
    locale: user.locale,
  };
}
