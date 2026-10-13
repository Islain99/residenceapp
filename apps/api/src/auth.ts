// Contrôle d'accès : jeton valide (authenticate), puis rôle (requireRole).
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { audit } from './lib/audit.js';
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
  asst?: string;            // accès d'assistance (assistance_grants.id) : admin plateforme en lecture seule
}

declare module 'fastify' {
  interface FastifyRequest {
    // Requête de l'admin plateforme en mode assistance (lecture seule)
    assistance?: { grantId: string };
  }
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
  if (request.user.asst) return authenticateAssistance(request, request.user.asst);
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

// ---------------------------------------------------------------------
// Accès d'assistance : l'admin plateforme consulte une résidence qui le lui
// a accordé (routes/assistance.ts). Vérifié à CHAQUE requête : un accès
// retiré ou expiré, une résidence suspendue, un compte admin désactivé
// coupent l'accès immédiatement.
//   * lecture seule : toute requête autre que GET est refusée ;
//   * jamais la messagerie (échanges privés entre employés) ni l'export
//     d'un dossier ;
//   * chaque consultation est inscrite au journal de la résidence
//     (une ligne par page consultée et par tranche de 5 minutes).
// ---------------------------------------------------------------------
const ASSISTANCE_BLOCKED = [/^\/conversations/, /^\/messages/, /^\/messaging/, /^\/admin\/conversations/, /\/export$/];

async function authenticateAssistance(request: FastifyRequest, grantId: string): Promise<void> {
  const { db } = request.server;
  const residenceId = request.user.rid;
  if (!residenceId) throw new HttpError(401, 'assistance_ended', 'Accès d’assistance terminé ou retiré.');
  const grant = await db.selectFrom('assistance_grants as g')
    .innerJoin('residences as r', 'r.id', 'g.residence_id')
    .innerJoin('users as a', (join) => join.on('a.id', '=', request.user.sub))
    .select(['g.id', 'g.residence_id'])
    .where('g.id', '=', grantId)
    .where('g.residence_id', '=', residenceId)
    .where('g.revoked_at', 'is', null)
    .where('g.expires_at', '>', sql<Date>`now()`)
    .where('r.is_active', '=', true)
    .where('a.is_active', '=', true)
    .where('a.role', '=', 'admin')
    .executeTakeFirst();
  if (!grant) throw new HttpError(401, 'assistance_ended', 'Accès d’assistance terminé ou retiré.');

  const route = request.routeOptions.url ?? request.url;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new HttpError(403, 'assistance_read_only', 'Accès d’assistance : consultation seulement.');
  }
  if (ASSISTANCE_BLOCKED.some((re) => re.test(route))) {
    throw new HttpError(403, 'assistance_forbidden', 'Accès d’assistance : cette page reste privée.');
  }

  request.user.role = 'responsable';
  request.assistance = { grantId };

  const params = (request.params ?? {}) as Record<string, string>;
  const recent = await db.selectFrom('audit_log')
    .select('id')
    .where('residence_id', '=', grant.residence_id)
    .where('user_id', '=', request.user.sub)
    .where('action', '=', 'assistance_view')
    .where('at', '>', sql<Date>`now() - interval '5 minutes'`)
    .where(sql<boolean>`details->>'route' = ${route} AND details->'params' = ${JSON.stringify(params)}::jsonb`)
    .limit(1)
    .executeTakeFirst();
  if (!recent) {
    await audit(db, {
      action: 'assistance_view', entity: 'assistance', entityId: grantId,
      userId: request.user.sub, residenceId: grant.residence_id,
      details: { grant: grantId, route, params }, ip: request.ip,
    });
  }
}
