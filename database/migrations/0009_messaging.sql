-- =====================================================================
-- 0009_messaging.sql — Messagerie interne
--
-- Quatre sortes de conversations (conversations.kind) :
--   * direct        : deux employés (direct_key = les deux identifiants triés,
--                     une seule conversation par paire) ;
--   * group         : plusieurs employés, avec un titre ;
--   * team          : toute l'équipe, une par résidence ;
--   * announcements : annonces de l'infirmière / de la responsable, une par
--                     résidence ; chaque employé confirme sa lecture.
-- Membres : listés (conversation_members) pour direct et group ; pour team et
-- announcements, ce sont tous les employés actifs de la résidence.
--
-- Rien n'est supprimé :
--   * un message se corrige ou se retire pendant 15 minutes (règle de l'API) ;
--     l'ancien texte va dans message_versions, un message retiré garde son
--     texte (retracted_at) : il n'est plus montré, sauf lors d'une
--     consultation tracée par la responsable (plainte, enquête) ;
--   * quitter un groupe = left_at.
--
-- Droits : app_user par défaut (0002, sans DELETE). app_readonly n'a AUCUN
-- accès à la messagerie : ce sont des échanges privés entre employés.
-- La version est enregistrée dans schema_migrations par 20-migrate.sh.
-- =====================================================================

BEGIN;

CREATE TABLE conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  residence_id    uuid NOT NULL REFERENCES residences(id),
  kind            text NOT NULL CHECK (kind IN ('direct', 'group', 'team', 'announcements')),
  title           text CHECK (title IS NULL OR length(btrim(title)) > 0),
  direct_key      text,                                 -- direct : « idA:idB », triés
  created_by      uuid,                                 -- NULL : canal créé automatiquement
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  CONSTRAINT conversations_residence_id_key UNIQUE (residence_id, id),
  CONSTRAINT conversations_creator_fk FOREIGN KEY (residence_id, created_by) REFERENCES users (residence_id, id),
  CONSTRAINT conversations_direct_key CHECK ((kind = 'direct') = (direct_key IS NOT NULL)),
  CONSTRAINT conversations_group_title CHECK (kind <> 'group' OR title IS NOT NULL)
);
CREATE UNIQUE INDEX conversations_direct_unique ON conversations (residence_id, direct_key) WHERE kind = 'direct';
CREATE UNIQUE INDEX conversations_channel_unique ON conversations (residence_id, kind) WHERE kind IN ('team', 'announcements');
CREATE INDEX conversations_recent ON conversations (residence_id, last_message_at DESC NULLS LAST);

CREATE TABLE conversation_members (
  residence_id    uuid NOT NULL,
  conversation_id uuid NOT NULL,
  user_id         uuid NOT NULL,
  added_by        uuid,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  left_at         timestamptz,
  PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT conversation_members_conv_fk FOREIGN KEY (residence_id, conversation_id) REFERENCES conversations (residence_id, id),
  CONSTRAINT conversation_members_user_fk FOREIGN KEY (residence_id, user_id) REFERENCES users (residence_id, id),
  CONSTRAINT conversation_members_added_fk FOREIGN KEY (residence_id, added_by) REFERENCES users (residence_id, id)
);
CREATE INDEX conversation_members_user ON conversation_members (user_id) WHERE left_at IS NULL;

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  residence_id    uuid NOT NULL,
  conversation_id uuid NOT NULL,
  author_id       uuid NOT NULL,
  body            text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 4000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  edited_at       timestamptz,
  retracted_at    timestamptz,
  CONSTRAINT messages_residence_id_key UNIQUE (residence_id, id),
  CONSTRAINT messages_conv_fk   FOREIGN KEY (residence_id, conversation_id) REFERENCES conversations (residence_id, id),
  CONSTRAINT messages_author_fk FOREIGN KEY (residence_id, author_id)       REFERENCES users (residence_id, id)
);
CREATE INDEX messages_conversation_time ON messages (conversation_id, created_at DESC, id DESC);

-- Versions remplacées par une correction (texte d'avant)
CREATE TABLE message_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  residence_id  uuid NOT NULL,
  message_id    uuid NOT NULL,
  previous_body text NOT NULL,
  edited_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_versions_msg_fk FOREIGN KEY (residence_id, message_id) REFERENCES messages (residence_id, id)
);
CREATE INDEX message_versions_message ON message_versions (message_id, edited_at);

-- Jusqu'où chacun a lu une conversation (non lus = messages plus récents)
CREATE TABLE conversation_reads (
  residence_id    uuid NOT NULL,
  conversation_id uuid NOT NULL,
  user_id         uuid NOT NULL,
  last_read_at    timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT conversation_reads_conv_fk FOREIGN KEY (residence_id, conversation_id) REFERENCES conversations (residence_id, id),
  CONSTRAINT conversation_reads_user_fk FOREIGN KEY (residence_id, user_id) REFERENCES users (residence_id, id)
);

-- Annonces : confirmation de lecture, message par message
CREATE TABLE message_acks (
  residence_id uuid NOT NULL,
  message_id   uuid NOT NULL,
  user_id      uuid NOT NULL,
  acked_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id),
  CONSTRAINT message_acks_msg_fk  FOREIGN KEY (residence_id, message_id) REFERENCES messages (residence_id, id),
  CONSTRAINT message_acks_user_fk FOREIGN KEY (residence_id, user_id) REFERENCES users (residence_id, id)
);

-- Canaux « Équipe » et « Annonces » des résidences existantes
-- (l'API crée aussi ceux d'une nouvelle résidence au premier usage)
INSERT INTO conversations (residence_id, kind, title)
SELECT r.id, k.kind, k.title
FROM residences r
CROSS JOIN (VALUES ('team', 'Toute l''équipe'), ('announcements', 'Annonces')) AS k(kind, title)
ON CONFLICT DO NOTHING;

COMMIT;
