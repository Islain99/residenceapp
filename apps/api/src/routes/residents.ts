// Résidents de la résidence de l'utilisateur connecté.
//
// Règles :
//   * Liste et fiche : tous les rôles. Les notes réservées
//     (restricted_notes) ne sont lues et écrites que par une infirmière
//     ou une responsable.
//   * Créer ou modifier un résident : infirmière ou responsable.
//   * Aucune suppression : un départ = statut « parti » + date de départ.
//   * Consultation de la fiche, création et modification sont auditées.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql, type Selectable, type Updateable } from 'kysely';
import { authenticate, isSupervisor, requireRole, residenceOf, SUPERVISOR_ROLES } from '../auth.js';
import type { Residents } from '../db/types.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { DateOnly, IdParams, Nullable, optionalText, Text } from '../lib/schemas.js';

const Status = Type.Union([Type.Literal('actif'), Type.Literal('parti')]);

const ResidentSummary = Type.Object({
  id: Type.String(),
  firstName: Type.String(),
  lastName: Type.String(),
  room: Nullable(Type.String()),
  status: Type.String(),
  specialInstructions: Nullable(Type.String()),   // consignes visibles par toute l'équipe
});

const ResidentDetail = Type.Intersect([ResidentSummary, Type.Object({
  birthDate: Nullable(Type.String()),
  emergencyContact: Nullable(Type.String()),
  admittedAt: Nullable(Type.String()),
  leftAt: Nullable(Type.String()),
  restrictedNotes: Type.Optional(Nullable(Type.String())),   // absent si le rôle n'y a pas droit
  createdAt: Type.String(),
  updatedAt: Type.String(),
})]);

// Champs modifiables (création : prénom et nom obligatoires)
const editable = {
  room: Type.Optional(Nullable(Type.String({ maxLength: 20 }))),
  birthDate: Type.Optional(Nullable(DateOnly)),
  emergencyContact: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
  specialInstructions: Type.Optional(Nullable(Type.String({ maxLength: 2000 }))),
  restrictedNotes: Type.Optional(Nullable(Type.String({ maxLength: 5000 }))),
  admittedAt: Type.Optional(Nullable(DateOnly)),
};

type ResidentRow = Selectable<Residents>;

function toResident(row: Pick<ResidentRow, 'id' | 'first_name' | 'last_name' | 'room' | 'status' | 'special_instructions'>) {
  return {
    id: row.id, firstName: row.first_name, lastName: row.last_name, room: row.room,
    status: row.status, specialInstructions: row.special_instructions,
  };
}

function toDetail(row: ResidentRow, withRestricted: boolean) {
  return {
    ...toResident(row),
    birthDate: row.birth_date,
    emergencyContact: row.emergency_contact,
    admittedAt: row.admitted_at,
    leftAt: row.left_at,
    ...(withRestricted ? { restrictedNotes: row.restricted_notes } : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const requiredName = (value: string, field: string) => {
  const text = value.trim();
  if (!text) throw badRequest('invalid_name', `${field} obligatoire.`);
  return text;
};

const residentRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app;

  async function loadResident(residenceId: string, id: string): Promise<ResidentRow> {
    const row = await db.selectFrom('residents').selectAll()
      .where('id', '=', id).where('residence_id', '=', residenceId)
      .executeTakeFirst();
    if (!row) throw notFound('Résident introuvable.');
    return row;
  }

  // Liste par nom de famille ; recherche sur le nom ou la chambre, sans accents
  app.get('/residents', {
    preHandler: authenticate,
    schema: {
      querystring: Type.Object({
        status: Type.Union([Status, Type.Literal('all')], { default: 'actif' }),
        q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
      }),
      response: { 200: Type.Array(ResidentSummary) },
    },
  }, async (request) => {
    let query = db.selectFrom('residents')
      .select(['id', 'first_name', 'last_name', 'room', 'status', 'special_instructions'])
      .where('residence_id', '=', residenceOf(request));
    if (request.query.status !== 'all') query = query.where('status', '=', request.query.status);
    if (request.query.q) {
      const pattern = `%${request.query.q.trim().replace(/[\\%_]/g, '\\$&')}%`;
      query = query.where(sql<boolean>`(unaccent(first_name || ' ' || last_name) ILIKE unaccent(${pattern})
                                        OR room ILIKE ${pattern})`);
    }
    // Tri français (ICU) : la base est en classement C, où « Bélanger » viendrait après « Tremblay »
    const rows = await query
      .orderBy(sql`last_name COLLATE "fr-CA-x-icu"`)
      .orderBy(sql`first_name COLLATE "fr-CA-x-icu"`)
      .execute();
    return rows.map(toResident);
  });

  app.get('/residents/:id', {
    preHandler: authenticate,
    schema: { params: IdParams, response: { 200: ResidentDetail } },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const row = await loadResident(residenceId, request.params.id);
    await audit(db, {
      action: 'view', entity: 'resident', entityId: row.id, userId: request.user.sub,
      residenceId, ip: request.ip,
    });
    return toDetail(row, isSupervisor(request.user.role));
  });

  app.post('/residents', {
    preHandler: requireRole(...SUPERVISOR_ROLES),
    schema: {
      body: Type.Object({ firstName: Text(100), lastName: Text(100), ...editable }),
      response: { 201: ResidentDetail },
    },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const b = request.body;
    const row = await db.transaction().execute(async (trx) => {
      const row = await trx.insertInto('residents').values({
        residence_id: residenceId,
        first_name: requiredName(b.firstName, 'Prénom'),
        last_name: requiredName(b.lastName, 'Nom'),
        room: optionalText(b.room),
        birth_date: b.birthDate ?? null,
        emergency_contact: optionalText(b.emergencyContact),
        special_instructions: optionalText(b.specialInstructions),
        restricted_notes: optionalText(b.restrictedNotes),
        admitted_at: b.admittedAt ?? null,
      }).returningAll().executeTakeFirstOrThrow();
      await audit(trx, {
        action: 'create', entity: 'resident', entityId: row.id, userId: request.user.sub,
        residenceId, ip: request.ip,
      });
      return row;
    });
    return reply.code(201).send(toDetail(row, true));
  });

  // Modification partielle. Départ : status « parti » + leftAt ; retour : status « actif »
  app.patch('/residents/:id', {
    preHandler: requireRole(...SUPERVISOR_ROLES),
    schema: {
      params: IdParams,
      body: Type.Object({
        firstName: Type.Optional(Text(100)),
        lastName: Type.Optional(Text(100)),
        status: Type.Optional(Status),
        leftAt: Type.Optional(Nullable(DateOnly)),
        ...editable,
      }, { minProperties: 1 }),
      response: { 200: ResidentDetail },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const b = request.body;
    const current = await loadResident(residenceId, request.params.id);

    const changes: Updateable<Residents> = {};
    if (b.firstName !== undefined) changes.first_name = requiredName(b.firstName, 'Prénom');
    if (b.lastName !== undefined) changes.last_name = requiredName(b.lastName, 'Nom');
    if (b.room !== undefined) changes.room = optionalText(b.room);
    if (b.birthDate !== undefined) changes.birth_date = b.birthDate;
    if (b.emergencyContact !== undefined) changes.emergency_contact = optionalText(b.emergencyContact);
    if (b.specialInstructions !== undefined) changes.special_instructions = optionalText(b.specialInstructions);
    if (b.restrictedNotes !== undefined) changes.restricted_notes = optionalText(b.restrictedNotes);
    if (b.admittedAt !== undefined) changes.admitted_at = b.admittedAt;

    const status = b.status ?? current.status;
    if (status === 'parti') {
      const leftAt = b.leftAt !== undefined ? b.leftAt : current.left_at;
      if (!leftAt) throw badRequest('left_at_required', 'Date de départ obligatoire pour un résident parti.');
      changes.status = 'parti';
      changes.left_at = leftAt;
    } else {
      changes.status = 'actif';
      changes.left_at = null;
    }
    const admittedAt = changes.admitted_at !== undefined ? changes.admitted_at : current.admitted_at;
    if (changes.left_at && admittedAt && changes.left_at < admittedAt) {
      throw badRequest('invalid_left_at', "La date de départ précède la date d'admission.");
    }

    const row = await db.transaction().execute(async (trx) => {
      const row = await trx.updateTable('residents').set(changes)
        .where('id', '=', current.id).returningAll().executeTakeFirstOrThrow();
      await audit(trx, {
        action: 'update', entity: 'resident', entityId: current.id, userId: request.user.sub, residenceId,
        details: { fields: Object.keys(b) }, ip: request.ip,
      });
      return row;
    });
    return toDetail(row, true);
  });
};

export default residentRoutes;
