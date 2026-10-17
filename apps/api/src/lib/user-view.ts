// L'utilisateur connecté tel que renvoyé au client (connexion, /auth/me, profil).
import { Type } from '@fastify/type-provider-typebox';

// Couleurs possibles du rond avec les initiales (users.avatar_color, 0012)
export const AVATAR_COLORS = ['teal', 'blue', 'indigo', 'violet', 'pink', 'red', 'orange', 'green', 'slate'] as const;
export const AvatarColor = Type.Union(AVATAR_COLORS.map((c) => Type.Literal(c)));

export const UserBody = Type.Object({
  id: Type.String(),
  email: Type.String(),
  firstName: Type.String(),
  lastName: Type.String(),
  role: Type.String(),
  residenceId: Type.Union([Type.String(), Type.Null()]),
  phone: Type.Union([Type.String(), Type.Null()]),
  avatarColor: Type.Union([Type.String(), Type.Null()]),   // null : couleur choisie d'après l'id
});

export const USER_COLUMNS = ['id', 'email', 'first_name', 'last_name', 'role', 'residence_id', 'phone', 'avatar_color'] as const;

export function toUserBody(user: {
  id: string; email: string; first_name: string; last_name: string; role: string;
  residence_id: string | null; phone: string | null; avatar_color: string | null;
}) {
  return {
    id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name,
    role: user.role, residenceId: user.residence_id, phone: user.phone, avatarColor: user.avatar_color,
  };
}
