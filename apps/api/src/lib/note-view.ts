// Lecture d'une note telle que renvoyée au client (journal, relève, suivis).
import { Type } from '@fastify/type-provider-typebox';
import { sql, type Transaction } from 'kysely';
import type { Database } from '../db/index.js';
import type { DB } from '../db/types.js';
import { notFound } from './errors.js';
import { Nullable, Person } from './schemas.js';

export type Db = Database | Transaction<DB>;

export const NoteBody = Type.Object({
  id: Type.String(),
  occurredAt: Type.String(),
  description: Type.String(),
  intervention: Nullable(Type.String()),
  isPriority: Type.Boolean(),
  isPositive: Type.Boolean(),
  status: Type.String(),                 // active | annulee
  cancelReason: Nullable(Type.String()),
  cancelledAt: Nullable(Type.String()),
  cancelledBy: Nullable(Person),
  author: Person,
  category: Type.Object({ id: Type.String(), label: Type.String() }),
  resident: Nullable(Type.Object({
    id: Type.String(), firstName: Type.String(), lastName: Type.String(), room: Nullable(Type.String()),
  })),
  versionCount: Type.Integer(),          // nombre de corrections
  readByMe: Type.Boolean(),              // lecture confirmée par l'utilisateur connecté
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

// Notes de la résidence, avec auteur, catégorie, résident et état de lecture
// pour l'utilisateur userId.
export function noteQuery(db: Db, residenceId: string, userId: string) {
  return db.selectFrom('notes as n')
    .innerJoin('users as a', 'a.id', 'n.author_id')
    .innerJoin('note_categories as c', 'c.id', 'n.category_id')
    .leftJoin('residents as r', 'r.id', 'n.resident_id')
    .leftJoin('users as x', 'x.id', 'n.cancelled_by')
    .where('n.residence_id', '=', residenceId)
    .select((eb) => [
      'n.id', 'n.occurred_at', 'n.description', 'n.intervention', 'n.is_priority', 'n.is_positive',
      'n.status', 'n.cancel_reason', 'n.cancelled_at', 'n.created_at', 'n.updated_at',
      'a.id as author_id', 'a.first_name as author_first_name', 'a.last_name as author_last_name',
      'c.id as category_id', 'c.label as category_label',
      'r.id as resident_id', 'r.first_name as resident_first_name',
      'r.last_name as resident_last_name', 'r.room as resident_room',
      'x.id as cancelled_by_id', 'x.first_name as cancelled_by_first_name',
      'x.last_name as cancelled_by_last_name',
      eb.selectFrom('note_versions as v').whereRef('v.note_id', '=', 'n.id')
        .select((v) => v.fn.countAll<string>().as('count')).as('version_count'),
      eb.exists(eb.selectFrom('note_reads as nr').whereRef('nr.note_id', '=', 'n.id')
        .where('nr.user_id', '=', userId).select(sql`1`.as('one'))).as('read_by_me'),
      // Horodatage exact (microsecondes) pour la pagination
      sql<string>`to_char(n.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as('cursor_ts'),
    ]);
}

export type NoteRow = Awaited<ReturnType<ReturnType<typeof noteQuery>['executeTakeFirstOrThrow']>>;

export function toNote(row: NoteRow) {
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    description: row.description,
    intervention: row.intervention,
    isPriority: row.is_priority,
    isPositive: row.is_positive,
    status: row.status,
    cancelReason: row.cancel_reason,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    cancelledBy: row.cancelled_by_id
      ? { id: row.cancelled_by_id, firstName: row.cancelled_by_first_name ?? '', lastName: row.cancelled_by_last_name ?? '' }
      : null,
    author: { id: row.author_id, firstName: row.author_first_name, lastName: row.author_last_name },
    category: { id: row.category_id, label: row.category_label },
    resident: row.resident_id
      ? { id: row.resident_id, firstName: row.resident_first_name ?? '', lastName: row.resident_last_name ?? '', room: row.resident_room }
      : null,
    versionCount: Number(row.version_count ?? 0),
    readByMe: Boolean(row.read_by_me),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function findNote(db: Db, residenceId: string, userId: string, id: string) {
  const row = await noteQuery(db, residenceId, userId).where('n.id', '=', id).executeTakeFirst();
  if (!row) throw notFound('Note introuvable.');
  return toNote(row);
}
