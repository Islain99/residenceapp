// Plateforme — fonctionnalités d'une résidence, par rôle (lib/features.ts).
//
//   GET /platform/residences/:id/features   réglages, niveaux effectifs par rôle,
//                                           catalogue des modules, formules
//   PUT /platform/residences/:id/features   { settings, acceptCascade? }
//
// PUT reçoit la grille voulue (un niveau par module et par rôle ; absent :
// valeur par défaut). Refus :
//   400 invalid_level        niveau impossible pour ce module ou au-dessus du rôle
//   409 dependency_conflict  un module serait masqué par ses dépendances (ex.
//                            Relève sans Journal) : liste des conséquences ;
//                            renvoyer avec acceptCascade: true pour les accepter
// Enregistré : les niveaux effectifs (une conséquence acceptée est enregistrée
// telle quelle), NULL quand c'est la valeur par défaut. Chaque changement est
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
    };
  }

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

    const notified = changes.length ? await notifyResponsables(residence, request.user.sub, changes) : 0;
    return { ...(await body(residence)), changes, notified };
  });

  // Courriel aux responsables actives (une par langue de compte) ; jamais bloquant
  async function notifyResponsables(residence: { id: string; name: string }, adminId: string,
    changes: { role: FeatureRole; feature: Feature; from: Level; to: Level }[]): Promise<number> {
    const [admin, recipients] = await Promise.all([
      db.selectFrom('users').select(['first_name', 'last_name']).where('id', '=', adminId).executeTakeFirstOrThrow(),
      db.selectFrom('users').select(['email', 'first_name', 'locale'])
        .where('residence_id', '=', residence.id).where('role', '=', 'responsable')
        .where('is_active', '=', true).where('password_hash', 'is not', null).execute(),
    ]);
    let sent = 0;
    for (const to of recipients) {
      const locale = asLocale(to.locale);
      const m = MAIL_TEXT[locale];
      const f = FEATURE_TEXT[locale];
      const lines = changes.map((c) => m.features.change(f.roles[c.role], f.features[c.feature], f.levels[c.from], f.levels[c.to]));
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
