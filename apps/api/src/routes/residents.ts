// Résidents de la résidence de l'utilisateur connecté.
//
// Règles :
//   * Liste et fiche : tous les rôles. Les notes réservées
//     (restricted_notes) ne sont lues et écrites que par une infirmière
//     ou une responsable.
//   * Créer ou modifier un résident : infirmière ou responsable.
//   * Aucune suppression : un départ = statut « parti » + date de départ.
//   * Consultation de la fiche, création et modification sont auditées.
//   * Export complet d'un dossier (Loi 25, droit d'accès) : responsable
//     seulement, audité. GET /residents/:id/export
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql, type Selectable, type Updateable } from 'kysely';
import { authenticate, isSupervisor, requireRole, residenceOf, SUPERVISOR_ROLES } from '../auth.js';
import { followUpQuery, orderFollowUps, toFollowUp } from '../lib/follow-up-view.js';
import { noteQuery, toNote } from '../lib/note-view.js';
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

  // Export complet du dossier d'un résident, pour répondre à une demande
  // d'accès (Loi 25, art. 27) : fiche entière (champs réservés compris),
  // toutes les notes (annulées comprises) avec leurs corrections, les suivis,
  // et l'historique des consultations et modifications du dossier.
  app.get('/residents/:id/export', {
    preHandler: requireRole('responsable'),
    schema: { params: IdParams },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const resident = await loadResident(residenceId, request.params.id);

    const notes = await noteQuery(db, residenceId, request.user.sub)
      .where('n.resident_id', '=', resident.id)
      .orderBy('n.occurred_at').orderBy('n.id')
      .execute();
    const noteIds = notes.map((n) => n.id);

    const [versions, followUps, accessLog] = await Promise.all([
      noteIds.length === 0 ? [] : db.selectFrom('note_versions as v')
        .innerJoin('users as e', 'e.id', 'v.edited_by')
        .select(['v.note_id', 'v.edited_at', 'v.previous', 'e.id', 'e.first_name', 'e.last_name'])
        .where('v.note_id', 'in', noteIds)
        .orderBy('v.edited_at')
        .execute(),
      noteIds.length === 0 ? [] : orderFollowUps(followUpQuery(db, residenceId)
        .where('f.note_id', 'in', noteIds)).execute(),
      // Consultations et modifications du dossier et de ses notes
      db.selectFrom('audit_log as l')
        .leftJoin('users as u', 'u.id', 'l.user_id')
        .select(['l.at', 'l.action', 'l.entity', 'l.entity_id', 'u.id as user_id', 'u.first_name', 'u.last_name', 'u.role'])
        .where('l.residence_id', '=', residenceId)
        .where((eb) => eb.or([
          eb.and([eb('l.entity', '=', 'resident'), eb('l.entity_id', '=', resident.id)]),
          ...(noteIds.length ? [eb.and([eb('l.entity', '=', 'note'), eb('l.entity_id', 'in', noteIds)])] : []),
        ]))
        .orderBy('l.at')
        .execute(),
    ]);

    const exportedAt = new Date();
    await audit(db, {
      action: 'export', entity: 'resident', entityId: resident.id, userId: request.user.sub,
      residenceId, details: { notes: notes.length }, ip: request.ip,
    });

    const residence = await db.selectFrom('residences').select(['name'])
      .where('id', '=', residenceId).executeTakeFirstOrThrow();
    const fileName = `dossier-${resident.last_name}-${resident.first_name}-${exportedAt.toISOString().slice(0, 10)}`
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '-').toLowerCase();

    reply.header('content-disposition', `attachment; filename="${fileName}.json"`);
    return {
      format: 'residence-app/dossier-resident',
      version: 1,
      exportedAt: exportedAt.toISOString(),
      exportedBy: request.user.sub,
      residence: { id: residenceId, name: residence.name },
      resident: toDetail(resident, true),
      notes: notes.map((row) => ({
        ...toNote(row),
        corrections: versions.filter((v) => v.note_id === row.id).map((v) => ({
          editedAt: v.edited_at.toISOString(),
          editedBy: { id: v.id, firstName: v.first_name, lastName: v.last_name },
          previous: v.previous,
        })),
      })),
      followUps: followUps.map((f) => toFollowUp(f, exportedAt)),
      accessLog: accessLog.map((l) => ({
        at: l.at.toISOString(),
        action: l.action,
        entity: l.entity,
        entityId: l.entity_id,
        user: l.user_id ? { id: l.user_id, firstName: l.first_name, lastName: l.last_name, role: l.role } : null,
      })),
    };
  });
};

export default residentRoutes;
