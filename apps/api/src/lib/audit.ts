import type { Kysely, Transaction } from 'kysely';
import type { DB, JsonObject } from '../db/types.js';

export interface AuditEntry {
  action: string;          // login, login_failed, logout, refresh_reuse…
  entity: string;          // user, note, resident…
  entityId?: string | null;
  userId?: string | null;
  residenceId?: string | null;
  details?: JsonObject;    // jamais de contenu clinique complet
  ip?: string | null;
}

// audit_log est en ajout seul : on ne peut qu'insérer.
export async function audit(db: Kysely<DB> | Transaction<DB>, entry: AuditEntry): Promise<void> {
  await db.insertInto('audit_log').values({
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    user_id: entry.userId ?? null,
    residence_id: entry.residenceId ?? null,
    details: entry.details ?? null,
    ip: entry.ip ?? null,
  }).execute();
}
