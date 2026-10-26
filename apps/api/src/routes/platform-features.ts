// Plateforme — fonctionnalités d'une résidence, par rôle (lib/features.ts).
//
//   GET /platform/residences/:id/features   réglages, niveaux effectifs par rôle,
//                                           catalogue des modules, formules
//   PUT /platform/residences/:id/features   { settings, acceptCascade? }
//   PUT /platform/residences/:id/features/users/:userId   { feature, level, reason? }
//        exception pour une personne (remplace celle en cours pour ce module)
//   POST /platform/residences/:id/features/exceptions/:exceptionId/revoke
//        retirer une exception : retour au niveau de son rôle
//
// PUT reçoit la grille voulue (un niveau par module et par rôle ; absent :
// valeur par défaut). Refus :
//   400 invalid_level        niveau impossible pour ce module ou au-dessus du rôle
//   409 dependency_conflict  un module serait masqué par ses dépendances (ex.
//                            Relève sans Journal) : liste des conséquences ;
//                            renvoyer avec acceptCascade: true pour les accepter
// Enregistré : les niveaux effectifs (une conséquence acceptée est enregistrée
// telle quelle), NULL quand c'est la valeur par défaut. Une exception donne
// plus ou moins que le rôle dans la résidence, jamais plus que le rôle
// lui-même ; elle est retirée d'office si la personne change de rôle
// (lib/features.ts, revokeExceptionsOnRoleChange). Chaque changement est
// tracé (feature_update, avant → après) et les responsables actives de la
// résidence sont prévenues par courriel (un échec d'envoi n'annule rien).
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'kysely';
import { requireRole } from '../auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import {
  atLeast, defaultLevel, isFeature, effectiveFeatures, FEATURE_KEYS, FEATURE_ROLES, FEATURES, FORMULAS, formulaOf,
  settingsFromRows, type EffectiveFeatures, type Feature, type FeatureRole, type Level, type RoleSettings,
} from '../lib/features.js';
import { asLocale, FEATURE_TEXT, MAIL_TEXT } from '../lib/locale.js';
import { linkMail } from '../lib/mailer.js';
import { IdParams, Nullable, Person } from '../lib/schemas.js';
import { FeatureValue, LevelSchema } from './features.js';

// Clés validées à la main (modules et rôles du catalogue) : la forme reste simple
const RoleLevels = Type.Partial(Type.Object({ prepose: LevelSchema, infirmiere: LevelSchema, responsable: LevelSchema }));
const Settings = Type.Record(Type.String({ maxLength: 40 }), RoleLevels);
const Levels = Type.Record(Type.String(), LevelSchema);
const Grid = Type.Object({ prepose: Levels, infirmiere: Levels, responsable: Levels });
const Need = Type.Object({ feature: FeatureValue, min: LevelSchema });

const ExceptionBody = Type.Object({
  id: Type.String(),
  user: Type.Object({ id: Type.String(), firstName: Type.String(), lastName: Type.String(), role: Type.String() }),
  feature: FeatureValue,
  level: LevelSchema,          // niveau demandé pour la personne
  roleLevel: LevelSchema,      // niveau de son rôle dans la résidence
  effective: LevelSchema,      // niveau réel (après dépendances)
  reason: Nullable(Type.String()),
  createdAt: Type.String(),
  createdBy: Nullable(Person),
});

const FeaturesBody = Type.Object({
  residence: Type.Object({ id: Type.String(), name: Type.String() }),
  formula: Type.String(),
  settings: Settings,                 // écarts enregistrés (sans les valeurs par défaut)
  effective: Grid,                    // niveau réel de chaque module pour chaque rôle
  catalogue: Type.Array(Type.Object({
    key: FeatureValue,
    levels: Type.Array(LevelSchema),
    ceiling: Type.Object({ prepose: LevelSchema, infirmiere: LevelSchema, responsable: LevelSchema }),
    requires: Type.Array(Need),
    requiresAny: Type.Array(Need),
  })),
  formulas: Type.Record(Type.String(), Settings),
  updatedAt: Nullable(Type.String()),
  updatedBy: Nullable(Person),
  exceptions: Type.Array(ExceptionBody),
  // Employés actifs à qui on peut donner une exception
  staff: Type.Array(Type.Object({ id: Type.String(), firstName: Type.String(), lastName: Type.String(), role: Type.String() })),
});

const Change = Type.Object({ role: Type.String(), feature: FeatureValue, from: LevelSchema, to: LevelSchema });

const grid = (settings: RoleSettings) =>
  Object.fromEntries(FEATURE_ROLES.map((role) => [role, effectiveFeatures(role, settings)])) as Record<FeatureRole, EffectiveFeatures>;

const platformFeatureRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, config, mailer } = app;
  app.addHook('preHandler', requireRole('admin'));

  async function residenceOrThrow(id: string) {
    const residence = await db.selectFrom('residences').select(['id', 'name']).where('id', '=', id).executeTakeFirst();
    if (!residence) throw notFound('Résidence introuvable.');
    return residence;
  }

  const storedRows = (residenceId: string) => db.selectFrom('residence_features')
    .select(['feature', 'role', 'level']).where('residence_id', '=', residenceId).execute();

  async function body(residence: { id: string; name: string }) {
    const settings = settingsFromRows(await storedRows(residence.id));
    const [exceptions, staff] = await Promise.all([exceptionRows(residence.id), staffOf(residence.id)]);
    const byUser = new Map<string, Partial<Record<Feature, Level>>>();
    for (const e of exceptions) byUser.set(e.user_id, { ...byUser.get(e.user_id), [e.feature as Feature]: e.level as Level });
    const roleGrid = grid(settings);
    const last = await db.selectFrom('residence_features as f').leftJoin('users as u', 'u.id', 'f.updated_by')
      .select(['f.updated_at', 'u.id', 'u.first_name', 'u.last_name'])
      .where('f.residence_id', '=', residence.id).orderBy('f.updated_at', 'desc').limit(1).executeTakeFirst();
    return {
      residence,
      formula: formulaOf(settings),
      settings,
      effective: grid(settings),
      catalogue: FEATURE_KEYS.map((key) => ({
        key, levels: [...FEATURES[key].levels], ceiling: FEATURES[key].ceiling,
        requires: FEATURES[key].requires ?? [], requiresAny: FEATURES[key].requiresAny ?? [],
      })),
      formulas: FORMULAS as Record<string, RoleSettings>,
      updatedAt: last?.updated_at.toISOString() ?? null,
      updatedBy: last?.id ? { id: last.id, firstName: last.first_name!, lastName: last.last_name! } : null,
      exceptions: exceptions.filter((e) => isFeature(e.feature)).map((e) => {
        const role = e.role as FeatureRole;
        const feature = e.feature as Feature;
        return {
          id: e.id,
          user: { id: e.user_id, firstName: e.first_name, lastName: e.last_name, role },
          feature, level: e.level as Level,
          roleLevel: roleGrid[role][feature],
          effective: effectiveFeatures(role, settings, byUser.get(e.user_id))[feature],
          reason: e.reason,
          createdAt: e.created_at.toISOString(),
          createdBy: e.by_id ? { id: e.by_id, firstName: e.by_first!, lastName: e.by_last! } : null,
        };
      }),
      staff: staff.map((u) => ({ id: u.id, firstName: u.first_name, lastName: u.last_name, role: u.role })),
    };
  }

  // Exceptions en cours d'employés actifs de la résidence (rôle actuel)
  const exceptionRows = (residenceId: string) => db.selectFrom('user_features as f')
    .innerJoin('users as u', 'u.id', 'f.user_id')
    .leftJoin('users as c', 'c.id', 'f.created_by')
    .select(['f.id', 'f.user_id', 'f.feature', 'f.level', 'f.reason', 'f.created_at', 'u.first_name', 'u.last_name', 'u.role',
      'c.id as by_id', 'c.first_name as by_first', 'c.last_name as by_last'])
    .where('f.residence_id', '=', residenceId).where('f.revoked_at', 'is', null)
    .where('u.residence_id', '=', residenceId).where('u.is_active', '=', true)
    .where('u.role', 'in', [...FEATURE_ROLES])
    .orderBy('u.last_name').orderBy('u.first_name').orderBy('f.feature')
    .execute();

  const staffOf = (residenceId: string) => db.selectFrom('users').select(['id', 'first_name', 'last_name', 'role'])
    .where('residence_id', '=', residenceId).where('is_active', '=', true).where('role', 'in', [...FEATURE_ROLES])
    .orderBy('last_name').orderBy('first_name').execute();

  app.get('/platform/residences/:id/features', {
    schema: { params: IdParams, response: { 200: FeaturesBody } },
  }, async (request) => body(await residenceOrThrow(request.params.id)));

  app.put('/platform/residences/:id/features', {
    schema: {
      params: IdParams,
      body: Type.Object({ settings: Settings, acceptCascade: Type.Optional(Type.Boolean()) }),
      response: {
        200: Type.Intersect([FeaturesBody, Type.Object({ changes: Type.Array(Change), notified: Type.Integer() })]),
        409: Type.Object({
          error: Type.Literal('dependency_conflict'), message: Type.String(),
          conflicts: Type.Array(Type.Object({ role: Type.String(), feature: FeatureValue, requested: LevelSchema, effective: LevelSchema })),
        }),
      },
    },
  }, async (request, reply) => {
    const residence = await residenceOrThrow(request.params.id);
    const wanted = request.body.settings as RoleSettings;

    // Module du catalogue, niveau possible pour ce module, pas au-dessus du rôle
    for (const [feature, roles] of Object.entries(wanted) as [Feature, Partial<Record<FeatureRole, Level>>][]) {
      if (!isFeature(feature)) throw badRequest('unknown_feature', `Module inconnu : ${feature}.`);
      for (const [role, level] of Object.entries(roles) as [FeatureRole, Level][]) {
        const def = FEATURES[feature];
        if (!def.levels.includes(level) || !atLeast(def.ceiling[role], level)) {
          throw badRequest('invalid_level', `Niveau « ${level} » impossible pour ${feature} (${role}).`);
        }
      }
    }

    // Dépendances : ce qui serait masqué par un autre module
    const next = grid(wanted);
    const conflicts = FEATURE_ROLES.flatMap((role) => FEATURE_KEYS
      .map((feature) => ({ role, feature, requested: wanted[feature]?.[role] ?? defaultLevel(feature, role), effective: next[role][feature] }))
      .filter((c) => c.requested !== c.effective));
    if (conflicts.length && !request.body.acceptCascade) {
      return reply.code(409).send({
        error: 'dependency_conflict',
        message: 'Certains modules seraient masqués par leurs dépendances : confirmer pour les enregistrer ainsi.',
        conflicts,
      });
    }

    const before = grid(settingsFromRows(await storedRows(residence.id)));
    const changes = FEATURE_ROLES.flatMap((role) => FEATURE_KEYS
      .filter((feature) => before[role][feature] !== next[role][feature])
      .map((feature) => ({ role, feature, from: before[role][feature], to: next[role][feature] })));

    if (changes.length) {
      await db.transaction().execute(async (trx) => {
        for (const role of FEATURE_ROLES) {
          for (const feature of FEATURE_KEYS) {
            const level = next[role][feature] === defaultLevel(feature, role) ? null : next[role][feature];
            await trx.insertInto('residence_features')
              .values({ residence_id: residence.id, feature, role, level, updated_by: request.user.sub })
              .onConflict((oc) => oc.columns(['residence_id', 'feature', 'role']).doUpdateSet({
                level, updated_by: request.user.sub, updated_at: sql<Date>`now()`,
              }).where('residence_features.level', 'is distinct from', level))
              .execute();
          }
        }
        await audit(trx, {
          action: 'feature_update', entity: 'residence', entityId: residence.id, userId: request.user.sub,
          residenceId: residence.id, details: { formula: formulaOf(wanted), changes }, ip: request.ip,
        });
      });
      app.features.invalidate(residence.id);
    }

    const notified = !changes.length ? 0 : await notifyResponsables(residence, request.user.sub, (m, f) =>
      changes.map((c) => m.features.change(f.roles[c.role], f.features[c.feature], f.levels[c.from], f.levels[c.to])));
    return { ...(await body(residence)), changes, notified };
  });

  // --------------------------------------------- Exceptions pour une personne

  // Nouvelle exception, ou remplacement de celle en cours pour ce module
  app.put('/platform/residences/:id/features/users/:userId', {
    schema: {
      params: Type.Object({ id: Type.String({ format: 'uuid' }), userId: Type.String({ format: 'uuid' }) }),
      body: Type.Object({
        feature: Type.String({ maxLength: 40 }),
        level: LevelSchema,
        reason: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
      }),
      response: { 200: Type.Intersect([FeaturesBody, Type.Object({ notified: Type.Integer() })]) },
    },
  }, async (request) => {
    const residence = await residenceOrThrow(request.params.id);
    const { feature, level } = request.body;
    const reason = request.body.reason?.trim() || null;
    if (!isFeature(feature)) throw badRequest('unknown_feature', `Module inconnu : ${feature}.`);
    const user = await db.selectFrom('users').select(['id', 'first_name', 'last_name', 'role', 'is_active'])
      .where('id', '=', request.params.userId).where('residence_id', '=', residence.id).executeTakeFirst();
    if (!user || !user.is_active || !(FEATURE_ROLES as readonly string[]).includes(user.role)) {
      throw badRequest('invalid_user', 'Employé introuvable ou inactif dans cette résidence.');
    }
    const role = user.role as FeatureRole;
    const def = FEATURES[feature];
    if (!def.levels.includes(level) || !atLeast(def.ceiling[role], level)) {
      throw badRequest('invalid_level', `Niveau « ${level} » impossible pour ${feature} (${role}).`);
    }

    const settings = settingsFromRows(await storedRows(residence.id));
    const current = await db.selectFrom('user_features').select(['user_id', 'feature', 'level'])
      .where('user_id', '=', user.id).where('revoked_at', 'is', null).execute();
    const own = Object.fromEntries(current.filter((r) => isFeature(r.feature)).map((r) => [r.feature, r.level])) as Partial<Record<Feature, Level>>;
    const roleLevel = effectiveFeatures(role, settings)[feature];
    if (level === roleLevel) {
      throw badRequest('exception_same_as_role', 'C’est déjà le niveau de son rôle : aucune exception nécessaire.');
    }
    // Un niveau qu'une dépendance annulerait (ex. Dictée sans Journal en Complet) n'a pas de sens
    if (effectiveFeatures(role, settings, { ...own, [feature]: level })[feature] !== level) {
      throw badRequest('exception_blocked', 'Ce niveau dépend d’un autre module que cette personne n’a pas.');
    }
    const before = effectiveFeatures(role, settings, own)[feature];

    await db.transaction().execute(async (trx) => {
      await trx.updateTable('user_features')
        .set({ revoked_at: sql<Date>`now()`, revoked_by: request.user.sub, revoke_reason: 'replaced' })
        .where('user_id', '=', user.id).where('feature', '=', feature).where('revoked_at', 'is', null).execute();
      const row = await trx.insertInto('user_features')
        .values({ residence_id: residence.id, user_id: user.id, feature, level, reason, created_by: request.user.sub })
        .returning('id').executeTakeFirstOrThrow();
      await audit(trx, {
        action: 'feature_exception', entity: 'user', entityId: user.id, userId: request.user.sub, residenceId: residence.id,
        details: { exception: row.id, feature, from: before, to: level, role_level: roleLevel, ...(reason ? { reason } : {}) },
        ip: request.ip,
      });
    });
    app.features.invalidate(residence.id);

    const name = `${user.first_name} ${user.last_name}`;
    const notified = await notifyResponsables(residence, request.user.sub, (m, f) =>
      [m.features.exception(name, f.features[feature], f.levels[before], f.levels[level], reason)]);
    return { ...(await body(residence)), notified };
  });

  // Retirer une exception : la personne revient au niveau de son rôle
  app.post('/platform/residences/:id/features/exceptions/:exceptionId/revoke', {
    schema: {
      params: Type.Object({ id: Type.String({ format: 'uuid' }), exceptionId: Type.String({ format: 'uuid' }) }),
      response: { 200: Type.Intersect([FeaturesBody, Type.Object({ notified: Type.Integer() })]) },
    },
  }, async (request) => {
    const residence = await residenceOrThrow(request.params.id);
    const row = await db.updateTable('user_features')
      .set({ revoked_at: sql<Date>`now()`, revoked_by: request.user.sub, revoke_reason: 'removed' })
      .where('id', '=', request.params.exceptionId).where('residence_id', '=', residence.id).where('revoked_at', 'is', null)
      .returning(['user_id', 'feature', 'level']).executeTakeFirst();
    if (!row) throw notFound('Exception introuvable ou déjà retirée.');
    const user = await db.selectFrom('users').select(['first_name', 'last_name', 'role'])
      .where('id', '=', row.user_id).executeTakeFirstOrThrow();
    await audit(db, {
      action: 'feature_exception_revoke', entity: 'user', entityId: row.user_id, userId: request.user.sub,
      residenceId: residence.id, details: { exception: request.params.exceptionId, feature: row.feature, level: row.level }, ip: request.ip,
    });
    app.features.invalidate(residence.id);

    const notified = !isFeature(row.feature) || !(FEATURE_ROLES as readonly string[]).includes(user.role) ? 0
      : await (async () => {
        const feature = row.feature as Feature;
        const roleLevel = effectiveFeatures(user.role as FeatureRole, settingsFromRows(await storedRows(residence.id)))[feature];
        return notifyResponsables(residence, request.user.sub, (m, f) =>
          [m.features.exceptionRemoved(`${user.first_name} ${user.last_name}`, f.features[feature], f.levels[roleLevel])]);
      })();
    return { ...(await body(residence)), notified };
  });

  // Courriel aux responsables actives (une par langue de compte) ; jamais bloquant
  type Texts = [(typeof MAIL_TEXT)['fr'], (typeof FEATURE_TEXT)['fr']];
  async function notifyResponsables(residence: { id: string; name: string }, adminId: string,
    describe: (...texts: Texts) => string[]): Promise<number> {
    const [admin, recipients] = await Promise.all([
      db.selectFrom('users').select(['first_name', 'last_name']).where('id', '=', adminId).executeTakeFirstOrThrow(),
      db.selectFrom('users').select(['email', 'first_name', 'locale'])
        .where('residence_id', '=', residence.id).where('role', '=', 'responsable')
        .where('is_active', '=', true).where('password_hash', 'is not', null).execute(),
    ]);
    let sent = 0;
    for (const to of recipients) {
      const locale = asLocale(to.locale);
      const m = MAIL_TEXT[locale] as Texts[0];
      const lines = describe(m, FEATURE_TEXT[locale] as Texts[1]);
      try {
        await mailer.send(linkMail(to.email, m.features.subject(residence.name),
          [m.hello(to.first_name), m.features.body(`${admin.first_name} ${admin.last_name}`, residence.name), ...lines, m.features.effect],
          { label: m.features.button, url: config.APP_URL }, m.features.footer, locale));
        sent++;
      } catch {
        // Déjà journalisé par app.mailer ; le changement reste enregistré et tracé
      }
    }
    return sent;
  }
};

export default platformFeatureRoutes;
