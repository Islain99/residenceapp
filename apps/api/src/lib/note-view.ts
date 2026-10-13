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
  // Lecture confirmée par l'utilisateur connecté. Consigne prioritaire corrigée
  // depuis sa lecture : redevient false (à relire).
  readByMe: Type.Boolean(),
  // Note ordinaire corrigée après ma lecture (information, pas besoin de relire)
  modifiedSinceRead: Type.Boolean(),
  contentEditedAt: Nullable(Type.String()),   // dernière correction de fond
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

// Lecture valable de la note n par userId (SQL, pour les filtres) :
// une lecture existe, et pour une consigne prioritaire elle est postérieure
// à la dernière correction de fond.
export const validReadSql = (userId: string) => sql<boolean>`EXISTS (
  SELECT 1 FROM note_reads nr
  WHERE nr.note_id = n.id AND nr.user_id = ${userId}
    AND (NOT n.is_priority OR n.content_edited_at IS NULL OR nr.read_at >= n.content_edited_at))`;

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
      'n.status', 'n.cancel_reason', 'n.cancelled_at', 'n.created_at', 'n.updated_at', 'n.content_edited_at',
      'a.id as author_id', 'a.first_name as author_first_name', 'a.last_name as author_last_name',
      'c.id as category_id', 'c.label as category_label',
      'r.id as resident_id', 'r.first_name as resident_first_name',
      'r.last_name as resident_last_name', 'r.room as resident_room',
      'x.id as cancelled_by_id', 'x.first_name as cancelled_by_first_name',
      'x.last_name as cancelled_by_last_name',
      eb.selectFrom('note_versions as v').whereRef('v.note_id', '=', 'n.id')
        .select((v) => v.fn.countAll<string>().as('count')).as('version_count'),
      eb.selectFrom('note_reads as nr').whereRef('nr.note_id', '=', 'n.id')
        .where('nr.user_id', '=', userId).select('nr.read_at').as('my_read_at'),
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
    ...readState(row),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// État de lecture pour l'utilisateur de la requête (voir NoteBody)
function readState(row: Pick<NoteRow, 'my_read_at' | 'content_edited_at' | 'is_priority'>) {
  const readAt = row.my_read_at;
  const editedAt = row.content_edited_at;
  const stale = readAt !== null && editedAt !== null && readAt < editedAt;
  return {
    readByMe: readAt !== null && !(stale && row.is_priority),
    modifiedSinceRead: stale && !row.is_priority,
    contentEditedAt: editedAt?.toISOString() ?? null,
  };
}

export async function findNote(db: Db, residenceId: string, userId: string, id: string) {
  const row = await noteQuery(db, residenceId, userId).where('n.id', '=', id).executeTakeFirst();
  if (!row) throw notFound('Note introuvable.');
  return toNote(row);
}
