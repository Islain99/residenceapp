// Fonctionnalités activables : quel module (et quel niveau) chaque route de
// l'API exige. Contrôlé dans authenticate (auth.ts), après la lecture du
// compte : une page masquée ne reste pas accessible par une adresse directe.
//
// Chaque route de l'API figure ici, rattachée à un module ou déclarée
// « always » (toujours active) : sinon l'API refuse de démarrer (app.ts),
// pour qu'une route ajoutée plus tard ne passe pas entre les mailles.
//
// Les cas qui dépendent du contenu se règlent dans la route elle-même
// (requireFeature) : marquer une note prioritaire, publier dans les annonces,
// conversations visibles selon la Messagerie et les Annonces.
import type { FastifyRequest } from 'fastify';
import { HttpError } from './errors.js';
import { atLeast, FEATURES, type Feature, type FeatureRole, type Level } from './features.js';

interface Need { feature: Feature; min: Level }
export type RouteRule = 'always' | { all: Need[] } | { any: Need[] };

const need = (feature: Feature, min: Level): Need => ({ feature, min });
const read = (feature: Feature): RouteRule => ({ all: [need(feature, 'read')] });
const full = (feature: Feature): RouteRule => ({ all: [need(feature, 'full')] });

// Conversations : la Messagerie, ou au moins les Annonces
const conversations: RouteRule = { any: [need('messaging', 'full'), need('announcements', 'read')] };

export const ROUTE_FEATURES: Record<string, RouteRule> = {
  // Toujours actifs : connexion, compte, équipe, conformité, plateforme
  'GET /health': 'always',
  'GET /features': 'always',
  'GET /features/residence': 'always',
  'POST /auth/login': 'always',
  'POST /auth/mfa/verify': 'always',
  'POST /auth/mfa/setup': 'always',
  'POST /auth/mfa/enable': 'always',
  'GET /auth/mfa': 'always',
  'POST /auth/mfa/backup-codes': 'always',
  'POST /auth/refresh': 'always',
  'POST /auth/logout': 'always',
  'GET /auth/me': 'always',
  'PATCH /auth/me': 'always',
  'POST /auth/password/change': 'always',
  'POST /auth/password/forgot': 'always',
  'POST /auth/password/check': 'always',
  'POST /auth/password/reset': 'always',
  'GET /push/config': 'always',
  'POST /push/subscriptions': 'always',
  'POST /push/subscriptions/unsubscribe': 'always',
  'GET /push/preferences': 'always',
  'PATCH /push/preferences': 'always',
  'POST /push/test': 'always',
  'GET /staff': 'always',
  'GET /users': 'always',
  'POST /users': 'always',
  'POST /users/:id/invite': 'always',
  'PATCH /users/:id': 'always',
  'GET /audit': 'always',
  'GET /residents/:id/export': 'always',          // droit d'accès (Loi 25)
  'GET /admin/conversations': 'always',           // plainte : consultation par la responsable
  'POST /admin/conversations/:id/consult': 'always',
  'GET /assistance': 'always',
  'POST /assistance': 'always',
  'POST /assistance/:id/revoke': 'always',
  'GET /note-categories': 'always',               // liste de libellés (journal, statistiques)

  // Journal
  'GET /notes': read('journal'),
  'GET /notes/:id': read('journal'),
  'POST /notes/:id/read': read('journal'),
  'POST /notes': full('journal'),
  'PATCH /notes/:id': full('journal'),
  'POST /notes/:id/cancel': full('journal'),
  'POST /note-categories': read('journal'),
  'PATCH /note-categories/:id': read('journal'),

  // Relève
  'GET /handover': full('handover'),
  'POST /handover/ack': full('handover'),

  // Suivis (un suivi naît d'une note : la création exige aussi le Journal)
  'GET /follow-ups': read('followUps'),
  'GET /follow-ups/:id': read('followUps'),
  'POST /notes/:id/follow-ups': { all: [need('followUps', 'full'), need('journal', 'full')] },
  'PATCH /follow-ups/:id': full('followUps'),
  'POST /follow-ups/:id/close': full('followUps'),

  // Résidents. La liste sert aussi à choisir un résident (note, rendez-vous,
  // suivi) : accessible avec l'un de ces modules ; la fiche, non.
  'GET /residents': { any: [need('residents', 'read'), need('journal', 'read'), need('agenda', 'read'), need('followUps', 'read')] },
  'GET /residents/:id': read('residents'),
  'POST /residents': full('residents'),
  'PATCH /residents/:id': full('residents'),
  'GET /residents/:id/stats': read('stats'),

  // Agenda
  'GET /appointments': read('agenda'),
  'GET /appointments/:id': read('agenda'),
  'POST /appointments': full('agenda'),
  'PATCH /appointments/:id': full('agenda'),
  'POST /appointments/:id/cancel': full('agenda'),

  // Horaires
  'GET /shift-types': read('schedule'),
  'POST /shift-types': full('schedule'),
  'PATCH /shift-types/:id': full('schedule'),
  'GET /shifts': read('schedule'),
  'POST /shifts': full('schedule'),
  'PATCH /shifts/:id': full('schedule'),
  'POST /shifts/:id/cancel': full('schedule'),
  'POST /shifts/copy-week': full('schedule'),

  // Messagerie et annonces (routes/messages.ts filtre ensuite par conversation)
  'GET /conversations': conversations,
  'GET /messaging/summary': conversations,
  'GET /conversations/:id': conversations,
  'GET /conversations/:id/messages': conversations,
  'POST /conversations/:id/read': conversations,
  'PATCH /messages/:id': conversations,
  'POST /messages/:id/retract': conversations,
  'POST /conversations/:id/messages': { any: [need('messaging', 'full'), need('announcements', 'full')] },
  'POST /conversations': full('messaging'),
  'PATCH /conversations/:id': full('messaging'),
  'POST /conversations/:id/members': full('messaging'),
  'POST /conversations/:id/leave': full('messaging'),
  'POST /messages/:id/ack': read('announcements'),
  'GET /messages/:id/acks': full('announcements'),
};

export const routeKey = (method: string, url: string) => `${method} ${url}`;

// Règle d'une route ; l'administration de la plateforme (/platform/…) n'a
// aucune donnée de résidence : toujours active
export function ruleFor(method: string, url: string): RouteRule | undefined {
  return ROUTE_FEATURES[routeKey(method, url)] ?? (url.startsWith('/platform/') ? 'always' : undefined);
}

// Une exigence que le rôle ne peut de toute façon pas atteindre n'est pas
// vérifiée ici : le contrôle du rôle (requireRole, ou la route) répond, avec
// son propre message, comme avant les fonctionnalités activables.
const reachable = (role: FeatureRole, n: Need) => atLeast(FEATURES[n.feature].ceiling[role], n.min);
const met = (levels: Record<Feature, Level>, n: Need) => atLeast(levels[n.feature], n.min);

export class FeatureDisabled extends HttpError {
  constructor(readOnly: boolean, feature: Feature) {
    super(403, readOnly ? 'feature_read_only' : 'feature_disabled', readOnly
      ? 'Cette fonction est en consultation seulement dans votre résidence.'
      : 'Cette fonction n’est pas activée dans votre résidence.');
    this.feature = feature;
  }
  readonly feature: Feature;
}

function refuse(levels: Record<Feature, Level>, needs: Need[]): never {
  // « Consultation seulement » si le module est visible mais pas en écriture
  const missing = needs.find((n) => !met(levels, n)) ?? needs[0]!;
  throw new FeatureDisabled(levels[missing.feature] !== 'off', missing.feature);
}

// Contrôle d'une route pour la personne connectée (authenticate)
export async function checkRouteFeatures(request: FastifyRequest): Promise<void> {
  const residenceId = request.user.rid;
  if (!residenceId || request.user.role === 'admin') return;   // plateforme : aucune donnée de résidence
  const rule = ruleFor(request.method, request.routeOptions.url ?? '');
  if (!rule || rule === 'always') return;
  const role = request.user.role as FeatureRole;
  const needs = ('all' in rule ? rule.all : rule.any).filter((n) => reachable(role, n));
  if (needs.length === 0) return;
  const levels = await request.server.features.forUser(residenceId, request.user.sub, role);
  if ('all' in rule ? needs.every((n) => met(levels, n)) : needs.some((n) => met(levels, n))) return;
  refuse(levels, needs);
}

// Contrôle dans une route, quand l'exigence dépend du contenu
export async function requireFeature(request: FastifyRequest, feature: Feature, min: Level): Promise<void> {
  const level = await featureLevel(request, feature);
  if (!atLeast(level, min)) throw new FeatureDisabled(level !== 'off', feature);
}

export async function featureLevel(request: FastifyRequest, feature: Feature): Promise<Level> {
  const residenceId = request.user.rid;
  if (!residenceId) return 'off';
  return request.server.features.level(residenceId, request.user.sub, request.user.role as FeatureRole, feature);
}

export async function featureLevels(request: FastifyRequest): Promise<Record<Feature, Level>> {
  return request.server.features.forUser(request.user.rid!, request.user.sub, request.user.role as FeatureRole);
}
