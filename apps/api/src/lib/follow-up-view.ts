// Lecture d'un suivi tel que renvoyé au client (suivis, détail d'une note, relève).
import { Type } from '@fastify/type-provider-typebox';
import type { Db } from './note-view.js';
import { Nullable, Person } from './schemas.js';

const EXCERPT_LENGTH = 200;

export const FollowUpBody = Type.Object({
  id: Type.String(),
  description: Type.String(),
  dueAt: Nullable(Type.String()),
  isOverdue: Type.Boolean(),                // ouvert et échéance dépassée
  assignedTo: Nullable(Person),             // null : toute l'équipe
  createdBy: Nullable(Person),              // null : suivis antérieurs à la migration 0003
  createdAt: Type.String(),
  closedAt: Nullable(Type.String()),
  closedBy: Nullable(Person),
  closingNote: Nullable(Type.String()),
  note: Type.Object({ id: Type.String(), occurredAt: Type.String(), excerpt: Type.String() }),
  resident: Nullable(Type.Object({
    id: Type.String(), firstName: Type.String(), lastName: Type.String(), room: Nullable(Type.String()),
  })),
});

export function followUpQuery(db: Db, residenceId: string) {
  return db.selectFrom('follow_ups as f')
    .innerJoin('notes as n', 'n.id', 'f.note_id')
    .leftJoin('residents as r', 'r.id', 'n.resident_id')
    .leftJoin('users as asg', 'asg.id', 'f.assigned_to')
    .leftJoin('users as cre', 'cre.id', 'f.created_by')
    .leftJoin('users as clo', 'clo.id', 'f.closed_by')
    .where('f.residence_id', '=', residenceId)
    .select([
      'f.id', 'f.description', 'f.due_at', 'f.created_at', 'f.closed_at', 'f.closing_note',
      'n.id as note_id', 'n.occurred_at as note_occurred_at', 'n.description as note_description',
      'r.id as resident_id', 'r.first_name as resident_first_name',
      'r.last_name as resident_last_name', 'r.room as resident_room',
      'asg.id as assigned_id', 'asg.first_name as assigned_first_name', 'asg.last_name as assigned_last_name',
      'cre.id as created_id', 'cre.first_name as created_first_name', 'cre.last_name as created_last_name',
      'clo.id as closed_id', 'clo.first_name as closed_first_name', 'clo.last_name as closed_last_name',
    ]);
}

type FollowUpRow = Awaited<ReturnType<ReturnType<typeof followUpQuery>['executeTakeFirstOrThrow']>>;

const person = (id: string | null, firstName: string | null, lastName: string | null) =>
  id ? { id, firstName: firstName ?? '', lastName: lastName ?? '' } : null;

export function toFollowUp(row: FollowUpRow, now = new Date()) {
  const excerpt = row.note_description.length > EXCERPT_LENGTH
    ? `${row.note_description.slice(0, EXCERPT_LENGTH - 1)}…`
    : row.note_description;
  return {
    id: row.id,
    description: row.description,
    dueAt: row.due_at?.toISOString() ?? null,
    isOverdue: row.closed_at === null && row.due_at !== null && row.due_at < now,
    assignedTo: person(row.assigned_id, row.assigned_first_name, row.assigned_last_name),
    createdBy: person(row.created_id, row.created_first_name, row.created_last_name),
    createdAt: row.created_at.toISOString(),
    closedAt: row.closed_at?.toISOString() ?? null,
    closedBy: person(row.closed_id, row.closed_first_name, row.closed_last_name),
    closingNote: row.closing_note,
    note: { id: row.note_id, occurredAt: row.note_occurred_at.toISOString(), excerpt },
    resident: row.resident_id
      ? { id: row.resident_id, firstName: row.resident_first_name ?? '', lastName: row.resident_last_name ?? '', room: row.resident_room }
      : null,
  };
}

// Ouverts d'abord, puis par échéance (sans échéance en dernier), puis les plus anciens
export function orderFollowUps<Q extends ReturnType<typeof followUpQuery>>(query: Q): Q {
  return query
    .orderBy('f.closed_at', (o) => o.desc().nullsFirst())
    .orderBy('f.due_at', (o) => o.asc().nullsLast())
    .orderBy('f.created_at') as Q;
}
