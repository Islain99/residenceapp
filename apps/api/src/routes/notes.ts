// Journal de bord : notes de la résidence de l'utilisateur connecté.
//
// Règles :
//   * Toute requête est limitée à la résidence du jeton (request.user.rid) ;
//     une note d'une autre résidence répond 404.
//   * Tous les rôles peuvent écrire une note.
//   * Corriger ou annuler : l'auteur pendant 24 h, ou une infirmière /
//     responsable en tout temps. Une note annulée ne change plus.
//   * Aucune suppression : correction = ancienne version conservée
//     (note_versions), retrait = statut « annulee » avec motif.
//   * Création, correction, annulation et consultation sont auditées.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql, type Updateable } from 'kysely';
import { authenticate, isSupervisor, residenceOf, type AccessTokenPayload } from '../auth.js';
import type { Notes } from '../db/types.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import { FollowUpBody, followUpQuery, orderFollowUps, toFollowUp } from '../lib/follow-up-view.js';
import { findNote, NoteBody, noteQuery, toNote, type Db, type NoteRow } from '../lib/note-view.js';
import { IdParams, Nullable, optionalText, Person, Text, Uuid } from '../lib/schemas.js';

const AUTHOR_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;   // décalage d'horloge des appareils
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VersionBody = Type.Object({
  editedAt: Type.String(),
  editedBy: Person,
  previous: Type.Object({
    description: Type.String(),
    intervention: Nullable(Type.String()),
    categoryId: Type.String(),
    residentId: Nullable(Type.String()),
    occurredAt: Type.String(),
    isPriority: Type.Boolean(),
    isPositive: Type.Boolean(),
  }),
});

const ReadBody = Type.Object({ user: Person, readAt: Type.String() });

// Pagination : curseur opaque = (occurred_at, id) de la dernière note reçue
const encodeCursor = (row: NoteRow) => Buffer.from(`${row.cursor_ts}|${row.id}`).toString('base64url');
function decodeCursor(cursor: string): [string, string] {
  const [ts, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!ts || !id || !UUID.test(id) || Number.isNaN(Date.parse(ts))) {
    throw badRequest('invalid_cursor', 'Curseur de pagination invalide.');
  }
  return [ts, id];
}

// ---------------------------------------------------------------------
// Règles d'écriture
// ---------------------------------------------------------------------
interface LockedNote { author_id: string; created_at: Date; status: string }

function assertCanModify(user: AccessTokenPayload, note: LockedNote): void {
  if (note.status === 'annulee') {
    throw new HttpError(409, 'note_cancelled', 'Note annulée : elle ne peut plus être modifiée.');
  }
  if (isSupervisor(user.role)) return;
  if (note.author_id === user.sub && Date.now() - note.created_at.getTime() < AUTHOR_EDIT_WINDOW_MS) return;
  throw forbidden("Seul l'auteur (dans les 24 h) ou une infirmière / responsable peut modifier cette note.");
}

async function assertCategory(db: Db, residenceId: string, categoryId: string): Promise<void> {
  const found = await db.selectFrom('note_categories').select('id')
    .where('id', '=', categoryId).where('residence_id', '=', residenceId).where('is_active', '=', true)
    .executeTakeFirst();
  if (!found) throw badRequest('invalid_category', 'Catégorie inconnue ou inactive.');
}

async function assertResident(db: Db, residenceId: string, residentId: string): Promise<void> {
  const found = await db.selectFrom('residents').select('id')
    .where('id', '=', residentId).where('residence_id', '=', residenceId)
    .executeTakeFirst();
  if (!found) throw badRequest('invalid_resident', 'Résident introuvable.');
}

function parseOccurredAt(value: string): Date {
  const date = new Date(value);
  if (date.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    throw badRequest('invalid_occurred_at', "L'heure de l'événement ne peut pas être dans le futur.");
  }
  return date;
}

function requiredText(value: string): string {
  const text = value.trim();
  if (!text) throw badRequest('invalid_description', 'La description est obligatoire.');
  return text;
}

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------
const noteRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app;
  app.addHook('preHandler', authenticate);

  // Liste filtrée, la plus récente d'abord, paginée par curseur
  app.get('/notes', {
    schema: {
      querystring: Type.Object({
        residentId: Type.Optional(Uuid),
        categoryId: Type.Optional(Uuid),
        from: Type.Optional(Type.String({ format: 'date-time' })),
        to: Type.Optional(Type.String({ format: 'date-time' })),
        priority: Type.Optional(Type.Boolean()),
        unread: Type.Optional(Type.Boolean()),          // true : pas encore lues par moi
        status: Type.Union([Type.Literal('active'), Type.Literal('annulee'), Type.Literal('all')], { default: 'active' }),
        q: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),   // recherche plein texte
        limit: Type.Integer({ minimum: 1, maximum: 100, default: 50 }),
        cursor: Type.Optional(Type.String({ maxLength: 200 })),
      }),
      response: { 200: Type.Object({ items: Type.Array(NoteBody), nextCursor: Nullable(Type.String()) }) },
    },
  }, async (request) => {
    const f = request.query;
    const userId = request.user.sub;
    let query = noteQuery(db, residenceOf(request), userId);
    if (f.residentId) query = query.where('n.resident_id', '=', f.residentId);
    if (f.categoryId) query = query.where('n.category_id', '=', f.categoryId);
    if (f.from) query = query.where('n.occurred_at', '>=', new Date(f.from));
    if (f.to) query = query.where('n.occurred_at', '<', new Date(f.to));
    if (f.priority !== undefined) query = query.where('n.is_priority', '=', f.priority);
    if (f.unread !== undefined) {
      const read = sql<boolean>`EXISTS (SELECT 1 FROM note_reads nr WHERE nr.note_id = n.id AND nr.user_id = ${userId})`;
      query = query.where(f.unread ? sql<boolean>`NOT ${read}` : read);
    }
    if (f.status !== 'all') query = query.where('n.status', '=', f.status);
    if (f.q) query = query.where(sql<boolean>`n.search @@ websearch_to_tsquery('fr_unaccent', ${f.q})`);
    if (f.cursor) {
      const [ts, id] = decodeCursor(f.cursor);
      query = query.where(sql<boolean>`(n.occurred_at, n.id) < (${ts}::timestamptz, ${id}::uuid)`);
    }

    const rows = await query.orderBy('n.occurred_at', 'desc').orderBy('n.id', 'desc')
      .limit(f.limit + 1).execute();
    const page = rows.slice(0, f.limit);
    const last = page.at(-1);
    return {
      items: page.map(toNote),
      nextCursor: rows.length > f.limit && last ? encodeCursor(last) : null,
    };
  });

  // Une note, l'historique de ses corrections, ses suivis et qui l'a lue
  app.get('/notes/:id', {
    schema: {
      params: IdParams,
      response: {
        200: Type.Intersect([NoteBody, Type.Object({
          versions: Type.Array(VersionBody),
          followUps: Type.Array(FollowUpBody),
          reads: Type.Array(ReadBody),
        })]),
      },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const note = await findNote(db, residenceId, request.user.sub, request.params.id);
    const [versions, followUps, reads] = await Promise.all([
      db.selectFrom('note_versions as v')
        .innerJoin('users as e', 'e.id', 'v.edited_by')
        .select(['v.edited_at', 'v.previous', 'e.id', 'e.first_name', 'e.last_name'])
        .where('v.note_id', '=', note.id)
        .orderBy('v.edited_at', 'desc')
        .execute(),
      orderFollowUps(followUpQuery(db, residenceId).where('f.note_id', '=', note.id)).execute(),
      db.selectFrom('note_reads as nr')
        .innerJoin('users as u', 'u.id', 'nr.user_id')
        .select(['nr.read_at', 'u.id', 'u.first_name', 'u.last_name'])
        .where('nr.note_id', '=', note.id)
        .orderBy('nr.read_at')
        .execute(),
    ]);
    await audit(db, {
      action: 'view', entity: 'note', entityId: note.id, userId: request.user.sub,
      residenceId, ip: request.ip,
    });
    return {
      ...note,
      versions: versions.map((v) => {
        const p = v.previous as Record<string, unknown>;
        return {
          editedAt: v.edited_at.toISOString(),
          editedBy: { id: v.id, firstName: v.first_name, lastName: v.last_name },
          previous: {
            description: p.description as string,
            intervention: (p.intervention as string | null) ?? null,
            categoryId: p.category_id as string,
            residentId: (p.resident_id as string | null) ?? null,
            occurredAt: p.occurred_at as string,
            isPriority: p.is_priority as boolean,
            isPositive: p.is_positive as boolean,
          },
        };
      }),
      followUps: followUps.map((f) => toFollowUp(f)),
      reads: reads.map((r) => ({
        user: { id: r.id, firstName: r.first_name, lastName: r.last_name },
        readAt: r.read_at.toISOString(),
      })),
    };
  });

  // Nouvelle note (auteur = utilisateur connecté)
  app.post('/notes', {
    schema: {
      body: Type.Object({
        occurredAt: Type.String({ format: 'date-time' }),
        categoryId: Uuid,
        residentId: Type.Optional(Nullable(Uuid)),    // absent ou null : note générale
        description: Text(5000),
        intervention: Type.Optional(Nullable(Type.String({ maxLength: 5000 }))),
        isPriority: Type.Boolean({ default: false }),
        isPositive: Type.Boolean({ default: false }),
      }),
      response: { 201: NoteBody },
    },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const b = request.body;
    const id = await db.transaction().execute(async (trx) => {
      await assertCategory(trx, residenceId, b.categoryId);
      if (b.residentId) await assertResident(trx, residenceId, b.residentId);
      const { id } = await trx.insertInto('notes').values({
        residence_id: residenceId,
        author_id: request.user.sub,
        resident_id: b.residentId ?? null,
        category_id: b.categoryId,
        occurred_at: parseOccurredAt(b.occurredAt),
        description: requiredText(b.description),
        intervention: optionalText(b.intervention),
        is_priority: b.isPriority,
        is_positive: b.isPositive,
      }).returning('id').executeTakeFirstOrThrow();
      await audit(trx, {
        action: 'create', entity: 'note', entityId: id, userId: request.user.sub, residenceId,
        details: { resident_id: b.residentId ?? null, category_id: b.categoryId, is_priority: b.isPriority },
        ip: request.ip,
      });
      return id;
    });
    return reply.code(201).send(await findNote(db, residenceId, request.user.sub, id));
  });

  // Correction : seuls les champs envoyés changent ; l'ancienne version est conservée
  app.patch('/notes/:id', {
    schema: {
      params: IdParams,
      body: Type.Object({
        occurredAt: Type.Optional(Type.String({ format: 'date-time' })),
        categoryId: Type.Optional(Uuid),
        residentId: Type.Optional(Nullable(Uuid)),
        description: Type.Optional(Text(5000)),
        intervention: Type.Optional(Nullable(Type.String({ maxLength: 5000 }))),
        isPriority: Type.Optional(Type.Boolean()),
        isPositive: Type.Optional(Type.Boolean()),
      }, { minProperties: 1 }),
      response: { 200: NoteBody },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const b = request.body;
    await db.transaction().execute(async (trx) => {
      const note = await trx.selectFrom('notes').selectAll()
        .where('id', '=', request.params.id).where('residence_id', '=', residenceId)
        .forUpdate()   // deux corrections simultanées : la seconde attend
        .executeTakeFirst();
      if (!note) throw notFound('Note introuvable.');
      assertCanModify(request.user, note);

      const changes: Updateable<Notes> = {};
      if (b.description !== undefined) {
        const text = requiredText(b.description);
        if (text !== note.description) changes.description = text;
      }
      if (b.intervention !== undefined) {
        const text = optionalText(b.intervention);
        if (text !== note.intervention) changes.intervention = text;
      }
      if (b.categoryId !== undefined && b.categoryId !== note.category_id) {
        await assertCategory(trx, residenceId, b.categoryId);
        changes.category_id = b.categoryId;
      }
      if (b.residentId !== undefined && b.residentId !== note.resident_id) {
        if (b.residentId) await assertResident(trx, residenceId, b.residentId);
        changes.resident_id = b.residentId;
      }
      if (b.occurredAt !== undefined) {
        const date = parseOccurredAt(b.occurredAt);
        if (date.getTime() !== note.occurred_at.getTime()) changes.occurred_at = date;
      }
      if (b.isPriority !== undefined && b.isPriority !== note.is_priority) changes.is_priority = b.isPriority;
      if (b.isPositive !== undefined && b.isPositive !== note.is_positive) changes.is_positive = b.isPositive;

      const fields = Object.keys(changes);
      if (fields.length === 0) return;   // rien n'a changé : pas de nouvelle version

      await trx.insertInto('note_versions').values({
        residence_id: residenceId,
        note_id: note.id,
        edited_by: request.user.sub,
        previous: {
          description: note.description,
          intervention: note.intervention,
          category_id: note.category_id,
          resident_id: note.resident_id,
          occurred_at: note.occurred_at.toISOString(),
          is_priority: note.is_priority,
          is_positive: note.is_positive,
        },
      }).execute();
      await trx.updateTable('notes').set(changes).where('id', '=', note.id).execute();
      await audit(trx, {
        action: 'update', entity: 'note', entityId: note.id, userId: request.user.sub, residenceId,
        details: { fields }, ip: request.ip,
      });
    });
    return findNote(db, residenceId, request.user.sub, request.params.id);
  });

  // Annulation avec motif (la note reste visible avec le statut « annulee »)
  app.post('/notes/:id/cancel', {
    schema: {
      params: IdParams,
      body: Type.Object({ reason: Type.String({ minLength: 3, maxLength: 500 }) }),
      response: { 200: NoteBody },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const reason = request.body.reason.trim();
    if (reason.length < 3) throw badRequest('invalid_reason', "Le motif d'annulation est obligatoire.");

    await db.transaction().execute(async (trx) => {
      const note = await trx.selectFrom('notes').select(['id', 'author_id', 'created_at', 'status'])
        .where('id', '=', request.params.id).where('residence_id', '=', residenceId)
        .forUpdate()
        .executeTakeFirst();
      if (!note) throw notFound('Note introuvable.');
      assertCanModify(request.user, note);

      await trx.updateTable('notes').set({
        status: 'annulee', cancel_reason: reason, cancelled_by: request.user.sub, cancelled_at: new Date(),
      }).where('id', '=', note.id).execute();
      await audit(trx, {
        action: 'cancel', entity: 'note', entityId: note.id, userId: request.user.sub, residenceId,
        details: { reason }, ip: request.ip,
      });
    });
    return findNote(db, residenceId, request.user.sub, request.params.id);
  });

  // Confirmation de lecture (idempotente : la première lecture fait foi)
  app.post('/notes/:id/read', {
    schema: { params: IdParams },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const note = await db.selectFrom('notes').select('id')
      .where('id', '=', request.params.id).where('residence_id', '=', residenceId)
      .executeTakeFirst();
    if (!note) throw notFound('Note introuvable.');
    await db.insertInto('note_reads')
      .values({ residence_id: residenceId, note_id: note.id, user_id: request.user.sub })
      .onConflict((oc) => oc.columns(['note_id', 'user_id']).doNothing())
      .execute();
    return reply.code(204).send();
  });
};

export default noteRoutes;
