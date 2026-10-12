// Lecture d'un rendez-vous tel que renvoyé au client (agenda, relève, fiche résident).
import { Type } from '@fastify/type-provider-typebox';
import type { Db } from './note-view.js';
import { Nullable, Person } from './schemas.js';

export const KINDS = ['medical', 'transport', 'visite', 'activite', 'reunion', 'autre'] as const;
export type Kind = (typeof KINDS)[number];
export const Kind = Type.Union(KINDS.map((k) => Type.Literal(k)));

export const AppointmentBody = Type.Object({
  id: Type.String(),
  kind: Type.String(),
  title: Type.String(),
  location: Nullable(Type.String()),
  startsAt: Type.String(),
  endsAt: Nullable(Type.String()),
  details: Nullable(Type.String()),
  status: Type.String(),                 // prevu | annule
  cancelReason: Nullable(Type.String()),
  cancelledAt: Nullable(Type.String()),
  cancelledBy: Nullable(Person),
  resident: Nullable(Type.Object({
    id: Type.String(), firstName: Type.String(), lastName: Type.String(), room: Nullable(Type.String()),
  })),
  createdBy: Person,
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export function appointmentQuery(db: Db, residenceId: string) {
  return db.selectFrom('appointments as a')
    .innerJoin('users as c', 'c.id', 'a.created_by')
    .leftJoin('residents as r', 'r.id', 'a.resident_id')
    .leftJoin('users as x', 'x.id', 'a.cancelled_by')
    .where('a.residence_id', '=', residenceId)
    .select([
      'a.id', 'a.kind', 'a.title', 'a.location', 'a.starts_at', 'a.ends_at', 'a.details', 'a.status',
      'a.cancel_reason', 'a.cancelled_at', 'a.created_at', 'a.updated_at',
      'c.id as created_by_id', 'c.first_name as created_by_first_name', 'c.last_name as created_by_last_name',
      'r.id as resident_id', 'r.first_name as resident_first_name',
      'r.last_name as resident_last_name', 'r.room as resident_room',
      'x.id as cancelled_by_id', 'x.first_name as cancelled_by_first_name', 'x.last_name as cancelled_by_last_name',
    ]);
}

type AppointmentRow = Awaited<ReturnType<ReturnType<typeof appointmentQuery>['executeTakeFirstOrThrow']>>;

export function toAppointment(row: AppointmentRow) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    location: row.location,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at?.toISOString() ?? null,
    details: row.details,
    status: row.status,
    cancelReason: row.cancel_reason,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    cancelledBy: row.cancelled_by_id
      ? { id: row.cancelled_by_id, firstName: row.cancelled_by_first_name ?? '', lastName: row.cancelled_by_last_name ?? '' }
      : null,
    resident: row.resident_id
      ? { id: row.resident_id, firstName: row.resident_first_name ?? '', lastName: row.resident_last_name ?? '', room: row.resident_room }
      : null,
    createdBy: { id: row.created_by_id, firstName: row.created_by_first_name, lastName: row.created_by_last_name },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
