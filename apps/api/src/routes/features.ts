// Fonctionnalités actives pour la personne connectée (lib/features.ts).
//
//   GET /features   { features: { journal: 'full', residents: 'off', … }, locked: […] }
//
// L'interface construit la navigation et les boutons à partir de cette
// réponse ; l'API applique elle-même les mêmes niveaux à chaque route.
// En accès d'assistance : les niveaux de la responsable de la résidence.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { authenticate, residenceOf } from '../auth.js';
import { FEATURE_KEYS, LEVELS, LOCKED, type Feature, type FeatureRole, type Level } from '../lib/features.js';

export const LevelSchema = Type.Unsafe<Level>(Type.Union(LEVELS.map((l) => Type.Literal(l))));
export const FeatureSchema = Type.Union(FEATURE_KEYS.map((k) => Type.Literal(k)));
// Valeur (hors clé d'objet) : un module du catalogue
export const FeatureValue = Type.Unsafe<Feature>(FeatureSchema);

export const FeaturesBody = Type.Object({
  features: Type.Record(FeatureSchema, LevelSchema),
  locked: Type.Array(Type.String()),
});

const featureRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/features', {
    preHandler: authenticate,
    schema: { response: { 200: FeaturesBody } },
  }, async (request) => {
    const residenceId = residenceOf(request);   // admin hors assistance : 403
    const features = await app.features.forUser(residenceId, request.user.sub, request.user.role as FeatureRole);
    return { features, locked: [...LOCKED] };
  });
};

export default featureRoutes;
