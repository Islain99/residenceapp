// Contrôle d'accès : jeton valide (authenticate), puis rôle (requireRole).
import type { FastifyReply, FastifyRequest } from 'fastify';
import { forbidden } from './lib/errors.js';

export const ROLES = ['prepose', 'infirmiere', 'responsable', 'admin'] as const;
export type Role = (typeof ROLES)[number];

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

export async function authenticate(request: FastifyRequest): Promise<void> {
  await request.jwtVerify();   // 401 si absent, invalide ou expiré
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
