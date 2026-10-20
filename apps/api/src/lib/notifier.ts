// Notifications push (Web Push) : envoi aux appareils abonnés.
//
// Règle Loi 25 : une notification s'affiche sur l'écran verrouillé, à la vue
// de tous. Elle ne contient JAMAIS le nom d'un résident ni le texte d'une note
// ou d'un message : seulement le type d'événement et l'auteur. Le contenu
// s'ouvre dans l'application, après connexion.
//
// Envoi après la réponse (jamais dans la transaction) : une notification qui
// échoue ne fait pas échouer l'action. flush() attend les envois en cours
// (tests, arrêt propre).
import webpush from 'web-push';
import { sql } from 'kysely';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import { asLocale, pushIn, type Localized } from './locale.js';

export type NotificationKind = 'messages' | 'announcements' | 'priority_notes' | 'follow_ups';

// Contenu reçu par l'appareil (service worker)
export interface PushMessage {
  title: string;
  body: string;
  url: string;      // page ouverte au toucher
  tag?: string;     // même tag : la notification précédente est remplacée
}

// Avis à envoyer : titre et texte dans les deux langues (lib/locale.ts),
// chaque appareil reçoit la langue de son compte (users.locale)
export interface Notice {
  text: Localized<{ title: string; body: string }>;
  url: string;
  tag?: string;
}

export interface PushTarget { endpoint: string; p256dh: string; auth: string }
export type PushResult = 'ok' | 'gone' | 'error';

export interface PushSender {
  readonly publicKey: string;
  send(target: PushTarget, payload: string): Promise<PushResult>;
}

// Services de notification des navigateurs (Chrome, Firefox, Edge, Safari).
// Toute autre adresse est refusée : l'API n'envoie pas de requêtes n'importe où.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.apple\.com$/];

export function isAllowedEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

export function webPushSender(config: Config): PushSender | null {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) return null;
  webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
  return {
    publicKey: config.VAPID_PUBLIC_KEY,
    async send(target, payload) {
      try {
        await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          payload, { TTL: 6 * 3600, urgency: 'high' });
        return 'ok';
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        return status === 404 || status === 410 ? 'gone' : 'error';
      }
    },
  };
}

// Tests : notifications gardées en mémoire
export class MemoryPushSender implements PushSender {
  readonly publicKey = 'BFakeTestKeyForPushNotificationsInTests000000000000000000000000000000000000000000000';
  readonly sent: { endpoint: string; message: PushMessage }[] = [];
  gone = new Set<string>();
  async send(target: PushTarget, payload: string): Promise<PushResult> {
    if (this.gone.has(target.endpoint)) return 'gone';
    this.sent.push({ endpoint: target.endpoint, message: JSON.parse(payload) as PushMessage });
    return 'ok';
  }
}

const MAX_FAILURES = 5;

export class Notifier {
  private readonly pending = new Set<Promise<unknown>>();

  constructor(private readonly db: Database, readonly sender: PushSender | null, private readonly log: FastifyBaseLogger) {}

  get enabled() {
    return this.sender !== null;
  }

  // À appeler après la réponse : ne bloque pas, n'échoue jamais
  notify(userIds: string[], kind: NotificationKind, notice: Notice): void {
    if (!this.sender || userIds.length === 0) return;
    const job = this.deliver([...new Set(userIds)], kind, notice)
      .catch((err: unknown) => this.log.error({ err }, 'notification push'))
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  async flush(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  // Envoi direct à une personne (essai depuis « Mon compte »)
  async sendNow(userId: string, notice: Notice): Promise<number> {
    return this.deliver([userId], null, notice);
  }

  private async deliver(userIds: string[], kind: NotificationKind | null, notice: Notice): Promise<number> {
    const sender = this.sender;
    if (!sender) return 0;
    let query = this.db.selectFrom('push_subscriptions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .leftJoin('notification_preferences as p', 'p.user_id', 's.user_id')
      .select(['s.id', 's.endpoint', 's.p256dh', 's.auth', 'u.locale'])
      .where('s.user_id', 'in', userIds)
      .where('s.disabled_at', 'is', null)
      .where('u.is_active', '=', true);
    if (kind) query = query.where(sql<boolean>`coalesce(${sql.ref(`p.${kind}`)}, true)`);
    const targets = await query.execute();
    const payload = (locale: string) => {
      const message: PushMessage = { ...notice.text[asLocale(locale)], url: notice.url, ...(notice.tag ? { tag: notice.tag } : {}) };
      return JSON.stringify(message);
    };
    let sent = 0;
    await Promise.all(targets.map(async (t) => {
      const result = await sender.send(t, payload(t.locale));
      if (result === 'ok') {
        sent++;
        await this.db.updateTable('push_subscriptions').set({ last_sent_at: sql<Date>`now()`, failures: 0 })
          .where('id', '=', t.id).execute();
      } else if (result === 'gone') {
        // Abonnement expiré ou retiré par le navigateur
        await this.db.updateTable('push_subscriptions').set({ disabled_at: sql<Date>`now()` })
          .where('id', '=', t.id).execute();
      } else {
        await this.db.updateTable('push_subscriptions').set({
          failures: sql<number>`failures + 1`,
          disabled_at: sql<Date | null>`CASE WHEN failures + 1 >= ${MAX_FAILURES} THEN now() ELSE disabled_at END`,
        }).where('id', '=', t.id).execute();
      }
    }));
    return sent;
  }

  // ------------------------------------------------------------ Destinataires

  // Employés en quart maintenant (de 30 min avant le début à la fin du quart),
  // selon l'horaire. Résidence sans horaire aujourd'hui : toute l'équipe active.
  async onShiftNow(residenceId: string, exclude?: string): Promise<string[]> {
    const rows = await this.db.selectFrom('shifts as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .innerJoin('residences as r', 'r.id', 's.residence_id')
      .select('s.user_id')
      .where('s.residence_id', '=', residenceId)
      .where('s.cancelled_at', 'is', null)
      .where('u.is_active', '=', true)
      .where(sql<boolean>`now() BETWEEN
        ((s.work_date + s.start_time) AT TIME ZONE r.timezone) - interval '30 minutes'
        AND ((s.work_date + s.end_time + CASE WHEN s.end_time <= s.start_time THEN interval '1 day' ELSE interval '0' END)
             AT TIME ZONE r.timezone)`)
      .execute();
    let ids = rows.map((r) => r.user_id);
    if (ids.length === 0) {
      const scheduledToday = await this.db.selectFrom('shifts as s')
        .innerJoin('residences as r', 'r.id', 's.residence_id')
        .select('s.id')
        .where('s.residence_id', '=', residenceId).where('s.cancelled_at', 'is', null)
        .where(sql<boolean>`s.work_date = (now() AT TIME ZONE r.timezone)::date`)
        .limit(1).executeTakeFirst();
      if (!scheduledToday) ids = await this.activeStaff(residenceId);
    }
    return ids.filter((id) => id !== exclude);
  }

  async activeStaff(residenceId: string, exclude?: string): Promise<string[]> {
    const rows = await this.db.selectFrom('users').select('id')
      .where('residence_id', '=', residenceId).where('is_active', '=', true).execute();
    return rows.map((r) => r.id).filter((id) => id !== exclude);
  }

  // ---------------------------------------------------- Rappels d'échéance

  // Suivis ouverts dont l'échéance arrive dans les 30 minutes (ou vient de
  // passer) : un rappel, une seule fois, à la personne assignée ou à l'équipe
  // en quart. Chaque suivi est « réservé » par une mise à jour : deux API en
  // parallèle n'envoient pas deux fois.
  async sendDueReminders(): Promise<number> {
    if (!this.sender) return 0;
    const due = await this.db.updateTable('follow_ups')
      .set({ due_notified_at: sql<Date>`now()` })
      .where('id', 'in', (eb) => eb.selectFrom('follow_ups').select('id')
        .where('closed_at', 'is', null).where('due_notified_at', 'is', null)
        .where('due_at', '<=', sql<Date>`now() + interval '30 minutes'`)
        .forUpdate().skipLocked())
      .returning(['id', 'residence_id', 'assigned_to', 'due_at'])
      .execute();
    for (const f of due) {
      // Échéance passée depuis longtemps (suivi ancien) : marqué sans notification
      if (f.due_at && f.due_at.getTime() < Date.now() - 3600_000) continue;
      const recipients = f.assigned_to ? [f.assigned_to] : await this.onShiftNow(f.residence_id);
      this.notify(recipients, 'follow_ups', { text: pushIn((t) => t.followUpDue), url: '/suivis', tag: `follow-up-${f.id}` });
    }
    return due.length;
  }
}
