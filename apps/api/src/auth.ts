// Contrôle d'accès : jeton valide (authenticate), puis rôle (requireRole).
import type { FastifyReply, FastifyRequest } from 'fastify';
import { forbidden, HttpError } from './lib/errors.js';

export const ROLES = ['prepose', 'infirmiere', 'responsable', 'admin'] as const;
export type Role = (typeof ROLES)[number];

// Rôles qui encadrent l'équipe : corrigent toute note, gèrent les résidents,
// lisent les notes réservées.
export const SUPERVISOR_ROLES: Role[] = ['infirmiere', 'responsable'];
export const isSupervisor = (role: Role) => SUPERVISOR_ROLES.includes(role);

// Contenu du jeton d'accès
export interface AccessTokenPayload {
  sub: string;              // users.id
  rid: string | null;       // residence_id (NULL : admin plateforme)
  role: Role;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AccessTokenPayload;
  }
}

// Jeton valide, puis compte relu dans la base à chaque requête : un compte
// désactivé (ou dont la résidence est désactivée) perd l'accès tout de suite,
// sans attendre l'expiration du jeton d'accès (15 min). Un changement de rôle
// s'applique aussi immédiatement.
export async function authenticate(request: FastifyRequest): Promise<void> {
  await request.jwtVerify();   // 401 si absent, invalide ou expiré
  const account = await request.server.db.selectFrom('users as u')
    .leftJoin('residences as r', 'r.id', 'u.residence_id')
    .select(['u.role', 'u.residence_id', 'u.is_active', 'r.is_active as residence_active'])
    .where('u.id', '=', request.user.sub)
    .executeTakeFirst();
  const active = account?.is_active && (account.residence_id === null || account.residence_active !== false);
  if (!account || !active || account.residence_id !== request.user.rid) {
    throw new HttpError(401, 'inactive_account', 'Compte désactivé.');
  }
  request.user.role = account.role as Role;
}

// Résidence de l'utilisateur connecté : toute donnée métier est filtrée
// par elle. L'admin plateforme (sans résidence) n'y a pas accès.
export function residenceOf(request: FastifyRequest): string {
  const rid = request.user.rid;
  if (!rid) throw forbidden('Aucune résidence associée à ce compte.');
  return rid;
}

export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request);
    if (!roles.includes(request.user.role)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Accès refusé pour ce rôle.' });
    }
  };
}
