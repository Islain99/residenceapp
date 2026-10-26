// Messagerie interne.
//
// Conversations (kind) :
//   direct        deux employés, une seule conversation par paire ;
//   group         plusieurs employés, avec un titre ; on y ajoute des collègues, on le quitte ;
//   team          toute l'équipe (tous les employés actifs), une par résidence ;
//   announcements annonces : seules l'infirmière et la responsable publient,
//                 chacun confirme sa lecture, message par message.
//
// Règles :
//   * Texte seulement (4 000 caractères au plus).
//   * L'auteur corrige ou retire son message pendant 15 minutes. Rien n'est
//     supprimé : l'ancien texte est conservé (message_versions), un message
//     retiré garde son texte, montré seulement lors d'une consultation tracée.
//   * La responsable peut consulter une conversation privée ou de groupe dont
//     elle n'est pas membre (plainte, enquête), avec un motif obligatoire,
//     inscrit au journal d'audit.
//   * Lu / non lu : chacun avance son « lu jusqu'à » (conversation_reads).
//   * Les messages ne sont pas inscrits un à un au journal d'audit (ils sont
//     eux-mêmes conservés) ; création de conversation, ajout de membres,
//     correction, retrait et consultation le sont.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'kysely';
import { authenticate, isSupervisor, requireRole, residenceOf, type Role } from '../auth.js';
import { FeatureDisabled } from '../lib/feature-routes.js';
import { atLeast, type FeatureRole, type FeatureStore } from '../lib/features.js';
import { audit } from '../lib/audit.js';
import { pushIn } from '../lib/locale.js';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import type { Db } from '../lib/note-view.js';
import { IdParams, Nullable, Person, Uuid } from '../lib/schemas.js';

export const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_BODY = 4000;
const CHANNEL_TITLES = { team: "Toute l'équipe", announcements: 'Annonces' } as const;

const isChannel = (kind: string) => kind === 'team' || kind === 'announcements';

// ---------------------------------------------------------------------
// Schémas de réponse
// ---------------------------------------------------------------------
const Member = Type.Intersect([Person, Type.Object({ isActive: Type.Boolean() })]);

const ConversationBody = Type.Object({
  id: Type.String(),
  kind: Type.String(),
  title: Type.String(),                       // direct : nom de l'autre personne
  members: Type.Array(Member),                // direct et group ; vide pour team et announcements
  memberCount: Type.Integer(),
  createdBy: Nullable(Type.String()),
  lastMessage: Nullable(Type.Object({
    id: Type.String(),
    excerpt: Nullable(Type.String()),         // null : message retiré
    author: Person,
    createdAt: Type.String(),
  })),
  lastMessageAt: Nullable(Type.String()),
  unreadCount: Type.Integer(),
  pendingAcks: Type.Integer(),                // annonces que je n'ai pas encore confirmées
  canPost: Type.Boolean(),
});

const MessageBody = Type.Object({
  id: Type.String(),
  conversationId: Type.String(),
  author: Person,
  body: Nullable(Type.String()),              // null : retiré
  createdAt: Type.String(),
  editedAt: Nullable(Type.String()),
  retractedAt: Nullable(Type.String()),
  mine: Type.Boolean(),
  editableUntil: Nullable(Type.String()),     // mon message, encore modifiable jusqu'à cette heure
  ack: Nullable(Type.Object({                 // annonces seulement
    ackedByMe: Type.Boolean(),
    count: Type.Integer(),
  })),
});

// ---------------------------------------------------------------------
// Accès aux données
// ---------------------------------------------------------------------

// Canaux Équipe et Annonces : créés au premier usage pour une nouvelle résidence
async function ensureChannels(db: Db, residenceId: string) {
  await sql`
    INSERT INTO conversations (residence_id, kind, title)
    VALUES (${residenceId}, 'team', ${CHANNEL_TITLES.team}), (${residenceId}, 'announcements', ${CHANNEL_TITLES.announcements})
    ON CONFLICT DO NOTHING`.execute(db);
}

// Conversations auxquelles userId a accès, avec son état de lecture
// Conversations visibles selon les fonctionnalités activables : la Messagerie
// (privées, groupes, fil d'équipe) et les Annonces, chacune de son côté
type Viewer = { sub: string; role: Role; rid: string | null };
interface Access { kinds: string[]; canAnnounce: boolean }

async function accessOf(features: FeatureStore, user: Viewer): Promise<Access> {
  if (!user.rid) return { kinds: [], canAnnounce: false };
  const levels = await features.forUser(user.rid, user.sub, user.role as FeatureRole);
  return {
    kinds: [
      ...(atLeast(levels.messaging, 'full') ? ['direct', 'group', 'team'] : []),
      ...(atLeast(levels.announcements, 'read') ? ['announcements'] : []),
    ],
    canAnnounce: atLeast(levels.announcements, 'full'),
  };
}

function conversationQuery(db: Db, residenceId: string, userId: string, kinds: string[]) {
  // Point de départ des non-lus : « lu jusqu'à », sinon l'arrivée dans le
  // groupe, sinon la création du compte (pas d'historique « non lu » d'avant)
  const baseline = sql<Date>`coalesce(
    (SELECT r.last_read_at FROM conversation_reads r WHERE r.conversation_id = c.id AND r.user_id = ${userId}),
    (SELECT cm.joined_at FROM conversation_members cm WHERE cm.conversation_id = c.id AND cm.user_id = ${userId}),
    (SELECT u.created_at FROM users u WHERE u.id = ${userId}))`;
  return db.selectFrom('conversations as c')
    .where('c.residence_id', '=', residenceId)
    .where(kinds.length ? sql<boolean>`c.kind IN (${sql.join(kinds)})` : sql<boolean>`false`)
    .where(sql<boolean>`(c.kind IN ('team', 'announcements') OR EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id = c.id AND cm.user_id = ${userId} AND cm.left_at IS NULL))`)
    .select([
      'c.id', 'c.kind', 'c.title', 'c.created_by', 'c.created_at', 'c.last_message_at',
      sql<string>`(SELECT count(*) FROM messages m
        WHERE m.conversation_id = c.id AND m.author_id <> ${userId} AND m.created_at > ${baseline})`.as('unread_count'),
      sql<string>`(SELECT count(*) FROM messages m
        WHERE c.kind = 'announcements' AND m.conversation_id = c.id AND m.author_id <> ${userId}
          AND m.retracted_at IS NULL AND m.created_at > (SELECT u.created_at FROM users u WHERE u.id = ${userId})
          AND NOT EXISTS (SELECT 1 FROM message_acks a WHERE a.message_id = m.id AND a.user_id = ${userId}))`.as('pending_acks'),
      sql<{ id: string; body: string | null; first_name: string; last_name: string; author_id: string; created_at: string } | null>`(
        SELECT json_build_object('id', m.id, 'body', CASE WHEN m.retracted_at IS NULL THEN m.body END,
          'author_id', u.id, 'first_name', u.first_name, 'last_name', u.last_name, 'created_at', m.created_at)
        FROM messages m JOIN users u ON u.id = m.author_id
        WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1)`.as('last_message'),
    ]);
}

type ConversationRow = Awaited<ReturnType<ReturnType<typeof conversationQuery>['executeTakeFirstOrThrow']>>;

async function membersOf(db: Db, conversationIds: string[]) {
  if (conversationIds.length === 0) return new Map<string, { id: string; firstName: string; lastName: string; isActive: boolean }[]>();
  const rows = await db.selectFrom('conversation_members as cm')
    .innerJoin('users as u', 'u.id', 'cm.user_id')
    .select(['cm.conversation_id', 'u.id', 'u.first_name', 'u.last_name', 'u.is_active'])
    .where('cm.conversation_id', 'in', conversationIds)
    .where('cm.left_at', 'is', null)
    .orderBy(sql`u.last_name COLLATE "fr-CA-x-icu"`).orderBy(sql`u.first_name COLLATE "fr-CA-x-icu"`)
    .execute();
  const map = new Map<string, { id: string; firstName: string; lastName: string; isActive: boolean }[]>();
  for (const r of rows) {
    const list = map.get(r.conversation_id) ?? [];
    list.push({ id: r.id, firstName: r.first_name, lastName: r.last_name, isActive: r.is_active });
    map.set(r.conversation_id, list);
  }
  return map;
}

async function activeStaffCount(db: Db, residenceId: string) {
  const { count } = await db.selectFrom('users').select((eb) => eb.fn.countAll<string>().as('count'))
    .where('residence_id', '=', residenceId).where('is_active', '=', true).where('password_hash', 'is not', null)
    .executeTakeFirstOrThrow();
  return Number(count);
}

function toConversation(
  row: ConversationRow,
  members: { id: string; firstName: string; lastName: string; isActive: boolean }[],
  user: { sub: string; role: Role },
  staffCount: number,
  canAnnounce: boolean,
) {
  const others = members.filter((m) => m.id !== user.sub);
  let title = row.title ?? '';
  if (row.kind === 'direct') {
    const other = others[0];
    title = other ? `${other.firstName} ${other.lastName}${other.isActive ? '' : ' (compte désactivé)'}` : 'Conversation';
  }
  const last = row.last_message;
  return {
    id: row.id,
    kind: row.kind,
    title,
    members: isChannel(row.kind) ? [] : members,
    memberCount: isChannel(row.kind) ? staffCount : members.length,
    createdBy: row.created_by,
    lastMessage: last ? {
      id: last.id,
      excerpt: last.body === null ? null : last.body.length > 120 ? `${last.body.slice(0, 119)}…` : last.body,
      author: { id: last.author_id, firstName: last.first_name, lastName: last.last_name },
      createdAt: new Date(last.created_at).toISOString(),
    } : null,
    lastMessageAt: row.last_message_at?.toISOString() ?? null,
    unreadCount: Number(row.unread_count),
    pendingAcks: Number(row.pending_acks),
    canPost: row.kind === 'announcements' ? canAnnounce   // infirmière, responsable (si Annonces en Complet)
      : row.kind === 'direct' ? others.every((m) => m.isActive) : true,
  };
}

// Messages d'une conversation, du plus récent au plus ancien
function messageQuery(db: Db, conversationId: string, userId: string) {
  return db.selectFrom('messages as m')
    .innerJoin('users as u', 'u.id', 'm.author_id')
    .innerJoin('conversations as c', 'c.id', 'm.conversation_id')
    .where('m.conversation_id', '=', conversationId)
    .select([
      'm.id', 'm.conversation_id', 'm.body', 'm.created_at', 'm.edited_at', 'm.retracted_at', 'm.author_id',
      'u.first_name', 'u.last_name', 'c.kind',
      sql<boolean>`EXISTS (SELECT 1 FROM message_acks a WHERE a.message_id = m.id AND a.user_id = ${userId})`.as('acked_by_me'),
      sql<string>`(SELECT count(*) FROM message_acks a WHERE a.message_id = m.id)`.as('ack_count'),
      sql<string>`to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as('cursor_ts'),
    ]);
}

type MessageRow = Awaited<ReturnType<ReturnType<typeof messageQuery>['executeTakeFirstOrThrow']>>;

function toMessage(row: MessageRow, userId: string, now = Date.now()) {
  const mine = row.author_id === userId;
  const until = row.created_at.getTime() + MESSAGE_EDIT_WINDOW_MS;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    author: { id: row.author_id, firstName: row.first_name, lastName: row.last_name },
    body: row.retracted_at ? null : row.body,
    createdAt: row.created_at.toISOString(),
    editedAt: row.edited_at?.toISOString() ?? null,
    retractedAt: row.retracted_at?.toISOString() ?? null,
    mine,
    editableUntil: mine && !row.retracted_at && until > now ? new Date(until).toISOString() : null,
    ack: row.kind === 'announcements' ? { ackedByMe: mine || Boolean(row.acked_by_me), count: Number(row.ack_count) } : null,
  };
}

// Espaces et lignes vides retirés au début et à la fin ; retours à la ligne internes conservés
const cleanBody = (value: string) => {
  const text = value.trim();
  if (!text.trim()) throw badRequest('empty_message', 'Le message est vide.');
  return text;
};

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------
const messageRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app;

  // Conversation accessible à l'utilisateur, sinon 404 (même réponse qu'inexistante)
  async function loadConversation(residenceId: string, user: Viewer, id: string) {
    const access = await accessOf(app.features, user);
    const row = await conversationQuery(db, residenceId, user.sub, access.kinds).where('c.id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Conversation introuvable.');
    const members = (await membersOf(db, [row.id])).get(row.id) ?? [];
    return toConversation(row, members, user, await activeStaffCount(db, residenceId), access.canAnnounce);
  }

  // Notification push : qui écrit et où, jamais le texte du message
  async function notifyMessage(residenceId: string, authorId: string,
    conversation: { id: string; kind: string; title: string; members: { id: string; isActive: boolean }[] }) {
    if (!app.notifier.enabled) return;
    const author = await db.selectFrom('users').select(['first_name', 'last_name'])
      .where('id', '=', authorId).executeTakeFirstOrThrow();
    const who = `${author.first_name} ${author.last_name.charAt(0)}.`;
    const recipients = isChannel(conversation.kind)
      ? await app.notifier.activeStaff(residenceId, authorId)
      : conversation.members.filter((m) => m.isActive && m.id !== authorId).map((m) => m.id);
    const url = `/messages/${conversation.id}`;
    if (conversation.kind === 'announcements') {
      app.notifier.notify(recipients, 'announcements', {
        text: pushIn((t) => t.announcement(who)), url, tag: `conversation-${conversation.id}`,
      });
    } else {
      app.notifier.notify(recipients, 'messages', {
        text: pushIn((t) => (conversation.kind === 'direct' ? t.message(who) : t.groupMessage(conversation.title, who))),
        url, tag: `conversation-${conversation.id}`,
      });
    }
  }

  async function assertColleagues(trx: Db, residenceId: string, ids: string[]) {
    if (ids.length === 0) return;
    const found = await trx.selectFrom('users').select('id')
      .where('id', 'in', ids).where('residence_id', '=', residenceId).where('is_active', '=', true)
      .execute();
    if (found.length !== new Set(ids).size) {
      throw badRequest('invalid_member', 'Employé introuvable ou inactif dans cette résidence.');
    }
  }

  async function loadOwnMessage(residenceId: string, user: Viewer, id: string) {
    const userId = user.sub;
    const row = await db.selectFrom('messages as m').innerJoin('conversations as c', 'c.id', 'm.conversation_id')
      .selectAll('m').select('c.kind')
      .where('m.id', '=', id).where('m.residence_id', '=', residenceId).executeTakeFirst();
    if (!row) throw notFound('Message introuvable.');
    // Conversation d'un module masqué : comme introuvable ; annonce : la publier doit être permis
    const access = await accessOf(app.features, user);
    if (!access.kinds.includes(row.kind)) throw notFound('Message introuvable.');
    if (row.kind === 'announcements' && !access.canAnnounce) throw new FeatureDisabled(true, 'announcements');
    if (row.author_id !== userId) throw forbidden('Seul l\'auteur peut corriger ou retirer son message.');
    if (row.retracted_at) throw new HttpError(409, 'message_retracted', 'Message déjà retiré.');
    if (Date.now() - row.created_at.getTime() > MESSAGE_EDIT_WINDOW_MS) {
      throw new HttpError(409, 'edit_window_over', 'Un message ne se corrige ou ne se retire que pendant 15 minutes.');
    }
    return row;
  }

  // --- Mes conversations, la plus récente d'abord -----------------------
  app.get('/conversations', {
    preHandler: authenticate,
    schema: { response: { 200: Type.Array(ConversationBody) } },
  }, async (request) => {
    const residenceId = residenceOf(request);
    await ensureChannels(db, residenceId);
    const access = await accessOf(app.features, request.user);
    const rows = await conversationQuery(db, residenceId, request.user.sub, access.kinds)
      .orderBy(sql`coalesce(c.last_message_at, c.created_at)`, 'desc')
      .execute();
    const members = await membersOf(db, rows.filter((r) => !isChannel(r.kind)).map((r) => r.id));
    const staff = await activeStaffCount(db, residenceId);
    return rows.map((r) => toConversation(r, members.get(r.id) ?? [], request.user, staff, access.canAnnounce));
  });

  // Résumé pour la navigation et la relève : non-lus, annonces à confirmer
  app.get('/messaging/summary', {
    preHandler: authenticate,
    schema: {
      response: {
        200: Type.Object({
          unread: Type.Integer(),
          announcements: Type.Array(MessageBody),   // annonces que je n'ai pas encore confirmées
        }),
      },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const userId = request.user.sub;
    await ensureChannels(db, residenceId);
    const rows = await conversationQuery(db, residenceId, userId, (await accessOf(app.features, request.user)).kinds).execute();
    const unread = rows.reduce((sum, r) => sum + Number(r.unread_count), 0);
    const channel = rows.find((r) => r.kind === 'announcements');
    const pending = channel && Number(channel.pending_acks) > 0
      ? await messageQuery(db, channel.id, userId)
        .where('m.author_id', '<>', userId)
        .where('m.retracted_at', 'is', null)
        .where(sql<boolean>`m.created_at > (SELECT created_at FROM users WHERE id = ${userId})`)
        .where(sql<boolean>`NOT EXISTS (SELECT 1 FROM message_acks a WHERE a.message_id = m.id AND a.user_id = ${userId})`)
        .orderBy('m.created_at')
        .execute()
      : [];
    return { unread, announcements: pending.map((m) => toMessage(m, userId)) };
  });

  // --- Nouvelle conversation ------------------------------------------
  app.post('/conversations', {
    preHandler: authenticate,
    schema: {
      body: Type.Union([
        Type.Object({ kind: Type.Literal('direct'), userId: Uuid }),
        Type.Object({
          kind: Type.Literal('group'),
          title: Type.String({ minLength: 1, maxLength: 80 }),
          memberIds: Type.Array(Uuid, { minItems: 1, maxItems: 100 }),
        }),
      ]),
      response: { 200: ConversationBody, 201: ConversationBody },
    },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const me = request.user.sub;
    const b = request.body;

    if (b.kind === 'direct') {
      if (b.userId === me) throw badRequest('self_conversation', 'Choisissez un collègue.');
      const key = [me, b.userId].sort().join(':');
      const existing = await db.selectFrom('conversations').select('id')
        .where('residence_id', '=', residenceId).where('kind', '=', 'direct').where('direct_key', '=', key)
        .executeTakeFirst();
      if (existing) return reply.code(200).send(await loadConversation(residenceId, request.user, existing.id));

      const id = await db.transaction().execute(async (trx) => {
        await assertColleagues(trx, residenceId, [b.userId]);
        const created = await trx.insertInto('conversations')
          .values({ residence_id: residenceId, kind: 'direct', direct_key: key, created_by: me })
          .onConflict((oc) => oc.columns(['residence_id', 'direct_key']).where('kind', '=', 'direct').doNothing())
          .returning('id').executeTakeFirst();
        if (!created) {   // créée au même instant par l'autre personne
          return (await trx.selectFrom('conversations').select('id')
            .where('residence_id', '=', residenceId).where('direct_key', '=', key).executeTakeFirstOrThrow()).id;
        }
        await trx.insertInto('conversation_members')
          .values([me, b.userId].map((user_id) => ({ residence_id: residenceId, conversation_id: created.id, user_id, added_by: me })))
          .execute();
        await audit(trx, {
          action: 'create', entity: 'conversation', entityId: created.id, userId: me, residenceId,
          details: { kind: 'direct' }, ip: request.ip,
        });
        return created.id;
      });
      return reply.code(201).send(await loadConversation(residenceId, request.user, id));
    }

    const title = b.title.trim();
    if (!title) throw badRequest('invalid_title', 'Donnez un nom au groupe.');
    const memberIds = [...new Set(b.memberIds.filter((id) => id !== me))];
    if (memberIds.length === 0) throw badRequest('no_members', 'Ajoutez au moins un collègue.');
    const id = await db.transaction().execute(async (trx) => {
      await assertColleagues(trx, residenceId, memberIds);
      const { id } = await trx.insertInto('conversations')
        .values({ residence_id: residenceId, kind: 'group', title, created_by: me })
        .returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('conversation_members')
        .values([me, ...memberIds].map((user_id) => ({ residence_id: residenceId, conversation_id: id, user_id, added_by: me })))
        .execute();
      await audit(trx, {
        action: 'create', entity: 'conversation', entityId: id, userId: me, residenceId,
        details: { kind: 'group', members: memberIds.length + 1 }, ip: request.ip,
      });
      return id;
    });
    return reply.code(201).send(await loadConversation(residenceId, request.user, id));
  });

  app.get('/conversations/:id', {
    preHandler: authenticate,
    schema: { params: IdParams, response: { 200: ConversationBody } },
  }, async (request) => loadConversation(residenceOf(request), request.user, request.params.id));

  // --- Groupe : renommer, ajouter des collègues, quitter ----------------
  async function loadGroup(residenceId: string, user: Viewer, id: string) {
    const conversation = await loadConversation(residenceId, user, id);
    if (conversation.kind !== 'group') throw badRequest('not_a_group', 'Seul un groupe peut être modifié.');
    return conversation;
  }

  app.patch('/conversations/:id', {
    preHandler: authenticate,
    schema: {
      params: IdParams,
      body: Type.Object({ title: Type.String({ minLength: 1, maxLength: 80 }) }),
      response: { 200: ConversationBody },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    await loadGroup(residenceId, request.user, request.params.id);
    const title = request.body.title.trim();
    if (!title) throw badRequest('invalid_title', 'Donnez un nom au groupe.');
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('conversations').set({ title }).where('id', '=', request.params.id).execute();
      await audit(trx, {
        action: 'update', entity: 'conversation', entityId: request.params.id, userId: request.user.sub,
        residenceId, details: { fields: ['title'] }, ip: request.ip,
      });
    });
    return loadConversation(residenceId, request.user, request.params.id);
  });

  app.post('/conversations/:id/members', {
    preHandler: authenticate,
    schema: {
      params: IdParams,
      body: Type.Object({ userIds: Type.Array(Uuid, { minItems: 1, maxItems: 100 }) }),
      response: { 200: ConversationBody },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const conversation = await loadGroup(residenceId, request.user, request.params.id);
    const current = new Set(conversation.members.map((m) => m.id));
    const toAdd = [...new Set(request.body.userIds)].filter((id) => !current.has(id));
    if (toAdd.length > 0) {
      await db.transaction().execute(async (trx) => {
        await assertColleagues(trx, residenceId, toAdd);
        await trx.insertInto('conversation_members')
          .values(toAdd.map((user_id) => ({
            residence_id: residenceId, conversation_id: conversation.id, user_id, added_by: request.user.sub,
          })))
          // Ancien membre qui revient : nouvelle arrivée
          .onConflict((oc) => oc.columns(['conversation_id', 'user_id']).doUpdateSet({
            left_at: null, joined_at: sql<Date>`now()`, added_by: request.user.sub,
          }))
          .execute();
        await audit(trx, {
          action: 'add_members', entity: 'conversation', entityId: conversation.id, userId: request.user.sub,
          residenceId, details: { added: toAdd.length }, ip: request.ip,
        });
      });
    }
    return loadConversation(residenceId, request.user, conversation.id);
  });

  app.post('/conversations/:id/leave', {
    preHandler: authenticate,
    schema: { params: IdParams },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const conversation = await loadGroup(residenceId, request.user, request.params.id);
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('conversation_members').set({ left_at: new Date() })
        .where('conversation_id', '=', conversation.id).where('user_id', '=', request.user.sub).execute();
      await audit(trx, {
        action: 'leave', entity: 'conversation', entityId: conversation.id, userId: request.user.sub,
        residenceId, ip: request.ip,
      });
    });
    return reply.code(204).send();
  });

  // --- Messages --------------------------------------------------------
  // Les plus récents d'abord (limit), ou avant un curseur pour remonter le fil
  app.get('/conversations/:id/messages', {
    preHandler: authenticate,
    schema: {
      params: IdParams,
      querystring: Type.Object({
        before: Type.Optional(Type.String({ maxLength: 100 })),
        limit: Type.Integer({ minimum: 1, maximum: 100, default: 50 }),
      }),
      response: {
        200: Type.Object({ items: Type.Array(MessageBody), nextCursor: Nullable(Type.String()) }),
      },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const conversation = await loadConversation(residenceId, request.user, request.params.id);
    let query = messageQuery(db, conversation.id, request.user.sub);
    if (request.query.before) {
      const [ts, id] = request.query.before.split('|');
      if (!ts || !id || Number.isNaN(Date.parse(ts))) throw badRequest('invalid_cursor', 'Curseur invalide.');
      query = query.where(sql<boolean>`(m.created_at, m.id) < (${ts}::timestamptz, ${id}::uuid)`);
    }
    const rows = await query.orderBy('m.created_at', 'desc').orderBy('m.id', 'desc')
      .limit(request.query.limit + 1).execute();
    const page = rows.slice(0, request.query.limit);
    const last = page.at(-1);
    const now = Date.now();
    return {
      // Ordre de lecture : du plus ancien au plus récent
      items: page.reverse().map((m) => toMessage(m, request.user.sub, now)),
      nextCursor: rows.length > request.query.limit && last ? `${last.cursor_ts}|${last.id}` : null,
    };
  });

  app.post('/conversations/:id/messages', {
    preHandler: authenticate,
    schema: {
      params: IdParams,
      body: Type.Object({ body: Type.String({ minLength: 1, maxLength: MAX_BODY }) }),
      response: { 201: MessageBody },
    },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const me = request.user.sub;
    const conversation = await loadConversation(residenceId, request.user, request.params.id);
    if (!conversation.canPost) {
      throw forbidden(conversation.kind === 'announcements'
        ? 'Seules l\'infirmière et la responsable publient des annonces.'
        : 'Ce collègue n\'a plus de compte actif.');
    }
    const body = cleanBody(request.body.body);
    const id = await db.transaction().execute(async (trx) => {
      const { id, created_at } = await trx.insertInto('messages')
        .values({ residence_id: residenceId, conversation_id: conversation.id, author_id: me, body })
        .returning(['id', 'created_at']).executeTakeFirstOrThrow();
      await trx.updateTable('conversations').set({ last_message_at: created_at })
        .where('id', '=', conversation.id).execute();
      // Écrire, c'est avoir lu la conversation jusque-là
      await trx.insertInto('conversation_reads')
        .values({ residence_id: residenceId, conversation_id: conversation.id, user_id: me, last_read_at: created_at })
        .onConflict((oc) => oc.columns(['conversation_id', 'user_id'])
          .doUpdateSet({ last_read_at: sql<Date>`greatest(conversation_reads.last_read_at, excluded.last_read_at)` }))
        .execute();
      return id;
    });
    const row = await messageQuery(db, conversation.id, me).where('m.id', '=', id).executeTakeFirstOrThrow();
    await notifyMessage(residenceId, me, conversation);
    return reply.code(201).send(toMessage(row, me));
  });

  // Corriger son message (15 min) : l'ancien texte est conservé
  app.patch('/messages/:id', {
    preHandler: authenticate,
    schema: {
      params: IdParams,
      body: Type.Object({ body: Type.String({ minLength: 1, maxLength: MAX_BODY }) }),
      response: { 200: MessageBody },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const me = request.user.sub;
    const current = await loadOwnMessage(residenceId, request.user, request.params.id);
    const body = cleanBody(request.body.body);
    if (body !== current.body) {
      await db.transaction().execute(async (trx) => {
        await trx.insertInto('message_versions')
          .values({ residence_id: residenceId, message_id: current.id, previous_body: current.body })
          .execute();
        await trx.updateTable('messages').set({ body, edited_at: new Date() }).where('id', '=', current.id).execute();
        await audit(trx, {
          action: 'update', entity: 'message', entityId: current.id, userId: me, residenceId,
          details: { conversation_id: current.conversation_id }, ip: request.ip,
        });
      });
    }
    const row = await messageQuery(db, current.conversation_id, me).where('m.id', '=', current.id).executeTakeFirstOrThrow();
    return toMessage(row, me);
  });

  // Retirer son message (15 min) : il n'est plus montré, mais il est conservé
  app.post('/messages/:id/retract', {
    preHandler: authenticate,
    schema: { params: IdParams, response: { 200: MessageBody } },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const me = request.user.sub;
    const current = await loadOwnMessage(residenceId, request.user, request.params.id);
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('messages').set({ retracted_at: new Date() }).where('id', '=', current.id).execute();
      await audit(trx, {
        action: 'retract', entity: 'message', entityId: current.id, userId: me, residenceId,
        details: { conversation_id: current.conversation_id }, ip: request.ip,
      });
    });
    const row = await messageQuery(db, current.conversation_id, me).where('m.id', '=', current.id).executeTakeFirstOrThrow();
    return toMessage(row, me);
  });

  // Lu jusqu'à maintenant
  app.post('/conversations/:id/read', {
    preHandler: authenticate,
    schema: { params: IdParams },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const conversation = await loadConversation(residenceId, request.user, request.params.id);
    await db.insertInto('conversation_reads')
      .values({ residence_id: residenceId, conversation_id: conversation.id, user_id: request.user.sub, last_read_at: sql<Date>`now()` })
      .onConflict((oc) => oc.columns(['conversation_id', 'user_id'])
        .doUpdateSet({ last_read_at: sql<Date>`greatest(conversation_reads.last_read_at, excluded.last_read_at)` }))
      .execute();
    return reply.code(204).send();
  });

  // --- Annonces : confirmer sa lecture, voir qui a confirmé -------------
  async function loadAnnouncement(residenceId: string, id: string) {
    const row = await db.selectFrom('messages as m')
      .innerJoin('conversations as c', 'c.id', 'm.conversation_id')
      .select(['m.id', 'm.author_id', 'm.retracted_at', 'm.created_at', 'c.kind'])
      .where('m.id', '=', id).where('m.residence_id', '=', residenceId).executeTakeFirst();
    if (!row) throw notFound('Message introuvable.');
    if (row.kind !== 'announcements') throw badRequest('not_an_announcement', 'Ce message n\'est pas une annonce.');
    return row;
  }

  app.post('/messages/:id/ack', {
    preHandler: authenticate,
    schema: { params: IdParams },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const message = await loadAnnouncement(residenceId, request.params.id);
    if (message.retracted_at) throw new HttpError(409, 'message_retracted', 'Annonce retirée.');
    await db.insertInto('message_acks')
      .values({ residence_id: residenceId, message_id: message.id, user_id: request.user.sub })
      .onConflict((oc) => oc.columns(['message_id', 'user_id']).doNothing())
      .execute();
    return reply.code(204).send();
  });

  app.get('/messages/:id/acks', {
    preHandler: authenticate,
    schema: {
      params: IdParams,
      response: {
        200: Type.Object({
          acked: Type.Array(Type.Object({ user: Person, ackedAt: Type.String() })),
          pending: Type.Array(Person),     // employés actifs qui n'ont pas encore confirmé
        }),
      },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    if (!isSupervisor(request.user.role)) throw forbidden('Réservé à l\'infirmière et à la responsable.');
    const message = await loadAnnouncement(residenceId, request.params.id);
    const [acked, pending] = await Promise.all([
      db.selectFrom('message_acks as a').innerJoin('users as u', 'u.id', 'a.user_id')
        .select(['u.id', 'u.first_name', 'u.last_name', 'a.acked_at'])
        .where('a.message_id', '=', message.id).orderBy('a.acked_at').execute(),
      db.selectFrom('users as u').select(['u.id', 'u.first_name', 'u.last_name'])
        .where('u.residence_id', '=', residenceId).where('u.is_active', '=', true)
        .where('u.password_hash', 'is not', null)
        .where('u.id', '<>', message.author_id)
        .where(sql<boolean>`NOT EXISTS (SELECT 1 FROM message_acks a WHERE a.message_id = ${message.id} AND a.user_id = u.id)`)
        .orderBy(sql`u.last_name COLLATE "fr-CA-x-icu"`).orderBy(sql`u.first_name COLLATE "fr-CA-x-icu"`)
        .execute(),
    ]);
    return {
      acked: acked.map((a) => ({ user: { id: a.id, firstName: a.first_name, lastName: a.last_name }, ackedAt: a.acked_at.toISOString() })),
      pending: pending.map((u) => ({ id: u.id, firstName: u.first_name, lastName: u.last_name })),
    };
  });

  // --- Consultation par la responsable (plainte, enquête) ---------------
  // Liste sans contenu : qui échange avec qui, combien de messages
  app.get('/admin/conversations', {
    preHandler: requireRole('responsable'),
    schema: {
      response: {
        200: Type.Array(Type.Object({
          id: Type.String(), kind: Type.String(), title: Nullable(Type.String()),
          members: Type.Array(Person), messageCount: Type.Integer(), lastMessageAt: Nullable(Type.String()),
        })),
      },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const rows = await db.selectFrom('conversations as c')
      .select(['c.id', 'c.kind', 'c.title', 'c.last_message_at',
        sql<string>`(SELECT count(*) FROM messages m WHERE m.conversation_id = c.id)`.as('message_count')])
      .where('c.residence_id', '=', residenceId).where('c.kind', 'in', ['direct', 'group'])
      .orderBy(sql`coalesce(c.last_message_at, c.created_at)`, 'desc')
      .execute();
    const members = await db.selectFrom('conversation_members as cm').innerJoin('users as u', 'u.id', 'cm.user_id')
      .select(['cm.conversation_id', 'u.id', 'u.first_name', 'u.last_name'])
      .where('cm.residence_id', '=', residenceId).execute();
    return rows.map((r) => ({
      id: r.id, kind: r.kind, title: r.title,
      members: members.filter((m) => m.conversation_id === r.id)
        .map((m) => ({ id: m.id, firstName: m.first_name, lastName: m.last_name })),
      messageCount: Number(r.message_count),
      lastMessageAt: r.last_message_at?.toISOString() ?? null,
    }));
  });

  // Contenu complet (messages retirés et versions corrigées compris), avec motif ; audité
  app.post('/admin/conversations/:id/consult', {
    preHandler: requireRole('responsable'),
    schema: {
      params: IdParams,
      body: Type.Object({ reason: Type.String({ minLength: 10, maxLength: 500 }) }),
      response: {
        200: Type.Object({
          messages: Type.Array(Type.Object({
            id: Type.String(), author: Person, body: Type.String(), createdAt: Type.String(),
            editedAt: Nullable(Type.String()), retractedAt: Nullable(Type.String()),
            versions: Type.Array(Type.Object({ body: Type.String(), replacedAt: Type.String() })),
          })),
        }),
      },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const conversation = await db.selectFrom('conversations').select(['id', 'kind'])
      .where('id', '=', request.params.id).where('residence_id', '=', residenceId).executeTakeFirst();
    if (!conversation) throw notFound('Conversation introuvable.');
    const reason = request.body.reason.trim();
    if (reason.length < 10) throw badRequest('reason_required', 'Indiquez le motif de la consultation (10 caractères minimum).');

    await audit(db, {
      action: 'consult', entity: 'conversation', entityId: conversation.id, userId: request.user.sub,
      residenceId, details: { reason, kind: conversation.kind }, ip: request.ip,
    });
    const [messages, versions] = await Promise.all([
      db.selectFrom('messages as m').innerJoin('users as u', 'u.id', 'm.author_id')
        .select(['m.id', 'm.body', 'm.created_at', 'm.edited_at', 'm.retracted_at', 'u.id as author_id', 'u.first_name', 'u.last_name'])
        .where('m.conversation_id', '=', conversation.id).orderBy('m.created_at').execute(),
      db.selectFrom('message_versions as v').innerJoin('messages as m', 'm.id', 'v.message_id')
        .select(['v.message_id', 'v.previous_body', 'v.edited_at'])
        .where('m.conversation_id', '=', conversation.id).orderBy('v.edited_at').execute(),
    ]);
    return {
      messages: messages.map((m) => ({
        id: m.id,
        author: { id: m.author_id, firstName: m.first_name, lastName: m.last_name },
        body: m.body,
        createdAt: m.created_at.toISOString(),
        editedAt: m.edited_at?.toISOString() ?? null,
        retractedAt: m.retracted_at?.toISOString() ?? null,
        versions: versions.filter((v) => v.message_id === m.id)
          .map((v) => ({ body: v.previous_body, replacedAt: v.edited_at.toISOString() })),
      })),
    };
  });
};

export default messageRoutes;
