-- =====================================================================
-- seed.sql — Données FICTIVES pour le développement et les démos.
-- Ne jamais exécuter en production.
--   1 résidence, 6 employés + 1 admin, 15 résidents, 8 catégories,
--   environ un mois de notes, des suivis, des relèves ; une deuxième
--   résidence, plus petite (tableau de bord de la plateforme).
-- Les mots de passe ne sont pas utilisables ici (password_hash factice) :
-- le seed de l'API les remplacera par de vrais hachages Argon2id.
-- =====================================================================

BEGIN;

-- Garde-fou : refuse de tourner sur une base qui contient déjà des résidences
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM residences) THEN
    RAISE EXCEPTION 'La base contient déjà des résidences : seed annulé.';
  END IF;
END $$;

SELECT setseed(0.42);  -- résultats reproductibles

INSERT INTO residences (id, name, type)
VALUES ('00000000-0000-4000-8000-000000000001', 'Résidence des Érables (fictive)', 'RPA');

INSERT INTO users (residence_id, email, password_hash, first_name, last_name, role) VALUES
  (NULL, 'admin@exemple.test', '!seed', 'Admin', 'Plateforme', 'admin'),
  ('00000000-0000-4000-8000-000000000001', 'responsable@exemple.test', '!seed', 'Sophie',  'Gagnon',   'responsable'),
  ('00000000-0000-4000-8000-000000000001', 'infirmiere@exemple.test',  '!seed', 'Nadia',   'Belkacem', 'infirmiere'),
  ('00000000-0000-4000-8000-000000000001', 'prepose1@exemple.test',    '!seed', 'Marc',    'Tremblay', 'prepose'),
  ('00000000-0000-4000-8000-000000000001', 'prepose2@exemple.test',    '!seed', 'Fatou',   'Diallo',   'prepose'),
  ('00000000-0000-4000-8000-000000000001', 'prepose3@exemple.test',    '!seed', 'Julien',  'Roy',      'prepose'),
  ('00000000-0000-4000-8000-000000000001', 'prepose4@exemple.test',    '!seed', 'Carmen',  'Lopez',    'prepose');

INSERT INTO note_categories (residence_id, label, sort_order)
SELECT '00000000-0000-4000-8000-000000000001', label, ord
FROM unnest(ARRAY['Comportement','Alimentation','Sommeil','Chute','Visite','Santé','Hygiène','Activité'])
     WITH ORDINALITY AS t(label, ord);

-- Quarts types (sur une base neuve, la migration 0007 passe avant la résidence)
INSERT INTO shift_types (residence_id, label, start_time, end_time, sort_order) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Jour', '07:00', '15:00', 1),
  ('00000000-0000-4000-8000-000000000001', 'Soir', '15:00', '23:00', 2),
  ('00000000-0000-4000-8000-000000000001', 'Nuit', '23:00', '07:00', 3);

-- Horaire de démonstration : semaine en cours et suivante. Chaque préposé
-- a un quart fixe, 5 jours sur 7 (rotation des congés) ; l'infirmière est
-- de jour en semaine.
INSERT INTO shifts (residence_id, user_id, shift_type_id, work_date, start_time, end_time, created_by)
SELECT st.residence_id, u.id, st.id, d::date, st.start_time, st.end_time,
       (SELECT id FROM users WHERE email = 'responsable@exemple.test')
FROM generate_series(date_trunc('week', now())::date, date_trunc('week', now())::date + 13, interval '1 day') AS d
JOIN users u ON u.email IN ('prepose1@exemple.test', 'prepose2@exemple.test', 'prepose3@exemple.test',
                            'prepose4@exemple.test', 'infirmiere@exemple.test')
JOIN shift_types st ON st.residence_id = u.residence_id
 AND st.label = CASE u.email WHEN 'prepose1@exemple.test' THEN 'Jour' WHEN 'prepose2@exemple.test' THEN 'Jour'
                             WHEN 'prepose3@exemple.test' THEN 'Soir' WHEN 'prepose4@exemple.test' THEN 'Nuit'
                             ELSE 'Jour' END
WHERE CASE u.email
        WHEN 'infirmiere@exemple.test' THEN extract(isodow FROM d) <= 5
        ELSE (extract(isodow FROM d)::int + right(split_part(u.email, '@', 1), 1)::int) % 7 NOT IN (0, 1)
      END;

INSERT INTO residents (residence_id, first_name, last_name, room, birth_date, emergency_contact, special_instructions, admitted_at)
SELECT '00000000-0000-4000-8000-000000000001', fn, ln, (100 + i)::text,
       date '1935-01-01' + (random() * 6000)::int,
       'Contact fictif ' || i || ' — 514-555-01' || lpad(i::text, 2, '0'),
       CASE WHEN i % 4 = 0 THEN 'Marchette obligatoire pour les déplacements' END,
       date '2022-01-01' + (random() * 1000)::int
FROM unnest(
  ARRAY['Jeanne','Gilles','Monique','Réal','Thérèse','André','Huguette','Roger','Lise','Gaston','Yvette','Marcel','Pierrette','Lucien','Rita'],
  ARRAY['Tremblay','Bouchard','Côté','Pelletier','Lavoie','Morin','Fortin','Gauthier','Ouellet','Bélanger','Lévesque','Bergeron','Caron','Girard','Poirier']
) WITH ORDINALITY AS t(fn, ln, i);

-- Environ 6 notes par jour sur 30 jours
WITH staff AS (
  SELECT array_agg(id) AS ids FROM users
  WHERE residence_id = '00000000-0000-4000-8000-000000000001'
), res AS (
  SELECT array_agg(id) AS ids FROM residents
), cat AS (
  SELECT array_agg(id ORDER BY sort_order) AS ids FROM note_categories
), texts AS (
  SELECT ARRAY[
    'A refusé son dîner, dit ne pas avoir faim.',
    'Nuit agitée, s''est levé trois fois.',
    'Visite de sa fille en après-midi, très bonne humeur.',
    'Trouvée assise au sol près du lit, sans blessure apparente.',
    'A participé à l''activité de bingo avec enthousiasme.',
    'Se plaint de douleur au genou droit.',
    'Douche complétée sans difficulté.',
    'Désorientée en fin de journée, cherchait la sortie.'
  ] AS d,
  ARRAY[
    'Collation offerte à 15 h, acceptée.',
    'Rassuré, verre d''eau offert.',
    NULL,
    'Aidée à se relever, infirmière avisée, signes vitaux pris.',
    NULL,
    'Infirmière avisée.',
    NULL,
    'Accompagnée à sa chambre, calme retrouvé.'
  ] AS iv
), gen AS (
  SELECT g,
         now() - interval '30 days' + (g * interval '4 hours') + (random() * interval '3 hours') AS ts,
         (random() * 7)::int + 1 AS k,
         random() AS r
  FROM generate_series(0, 179) AS g
)
INSERT INTO notes (residence_id, author_id, resident_id, category_id, occurred_at, description,
                   intervention, is_priority, is_positive, created_at)
SELECT '00000000-0000-4000-8000-000000000001',
       staff.ids[1 + (g % array_length(staff.ids, 1))],
       CASE WHEN r < 0.9 THEN res.ids[1 + (g * 7 % array_length(res.ids, 1))] END,
       cat.ids[CASE k WHEN 1 THEN 2 WHEN 2 THEN 3 WHEN 3 THEN 5 WHEN 4 THEN 4
                      WHEN 5 THEN 8 WHEN 6 THEN 6 WHEN 7 THEN 7 ELSE 1 END],
       ts, texts.d[k], texts.iv[k],
       (k IN (4, 8) AND r < 0.5),
       (k IN (3, 5)),
       ts + interval '10 minutes'
FROM gen, staff, res, cat, texts;

-- Un suivi pour chaque chute et chaque douleur
INSERT INTO follow_ups (residence_id, note_id, description, due_at, closed_at, closed_by, closing_note)
SELECT n.residence_id, n.id,
       CASE WHEN n.description LIKE 'Trouvée%' THEN 'Surveiller la mobilité pendant 48 h'
            ELSE 'Réévaluer la douleur au prochain quart' END,
       n.occurred_at + interval '8 hours',
       CASE WHEN n.occurred_at < now() - interval '3 days' THEN n.occurred_at + interval '9 hours' END,
       CASE WHEN n.occurred_at < now() - interval '3 days'
            THEN (SELECT id FROM users WHERE role = 'infirmiere' LIMIT 1) END,
       CASE WHEN n.occurred_at < now() - interval '3 days' THEN 'Situation stable.' END
FROM notes n
WHERE n.description LIKE 'Trouvée%' OR n.description LIKE 'Se plaint%';

-- Dernière relève de chaque employé : hier à la même heure
INSERT INTO handovers (residence_id, user_id, acknowledged_at)
SELECT residence_id, id, now() - interval '1 day'
FROM users WHERE residence_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Historique d'un an (statistiques) : ~240 notes réparties sur les 11 mois
-- précédant le dernier mois, tous résidents. Après les suivis : pas de
-- suivi ajouté pour cet historique.
-- ---------------------------------------------------------------------
WITH model(idx, label, description, intervention, positive) AS (VALUES
  (1, 'Alimentation', 'A mangé la moitié de son repas.',                 'Collation offerte plus tard.',          false),
  (2, 'Sommeil',      'Nuit agitée, plusieurs réveils.',                 'Rassuré, verre d''eau offert.',         false),
  (3, 'Visite',       'Visite de la famille, bon moment partagé.',       NULL,                                    true),
  (4, 'Chute',        'Trouvé au sol dans la salle de bain, sans blessure apparente.', 'Aidé à se relever, infirmière avisée.', false),
  (5, 'Activité',     'A participé à l''activité musicale.',             NULL,                                    true),
  (6, 'Santé',        'Se plaint de maux de tête.',                       'Infirmière avisée, signes vitaux pris.', false),
  (7, 'Hygiène',      'Bain complété avec aide.',                         NULL,                                    false),
  (8, 'Comportement', 'Agité en fin d''après-midi, a refusé ses soins.',  'Approche reportée, calme retrouvé.',     false)
), staff AS (
  SELECT array_agg(id) AS ids FROM users WHERE residence_id = '00000000-0000-4000-8000-000000000001'
), res AS (
  SELECT array_agg(id ORDER BY last_name) AS ids FROM residents
), gen AS (
  SELECT g,
         now() - interval '31 days' - (random() * interval '334 days') AS ts,
         1 + floor(random() * 8)::int AS k,
         1 + floor(random() * 15)::int AS who
  FROM generate_series(1, 240) AS g
)
INSERT INTO notes (residence_id, author_id, resident_id, category_id, occurred_at, description,
                   intervention, is_priority, is_positive, created_at)
SELECT '00000000-0000-4000-8000-000000000001',
       staff.ids[1 + (g % array_length(staff.ids, 1))],
       res.ids[who],
       c.id, ts, m.description, m.intervention, m.label = 'Chute', m.positive, ts + interval '15 minutes'
FROM gen
JOIN model m ON m.idx = gen.k
JOIN note_categories c ON c.residence_id = '00000000-0000-4000-8000-000000000001' AND c.label = m.label
CROSS JOIN staff CROSS JOIN res;

-- Tendance marquée pour Gaston Bélanger : chutes et nuits agitées en hausse
-- sur les quatre derniers mois (1, 2, 3 puis 4 chutes ; deux fois plus de nuits agitées).
INSERT INTO notes (residence_id, author_id, resident_id, category_id, occurred_at, description,
                   intervention, is_priority, is_positive, created_at)
SELECT '00000000-0000-4000-8000-000000000001',
       (SELECT id FROM users WHERE email = 'prepose4@exemple.test'),
       r.id, c.id, t.ts,
       CASE c.label WHEN 'Chute' THEN 'Trouvé assis au sol près du lit, sans blessure apparente.'
                    ELSE 'Nuit agitée, s''est levé plusieurs fois.' END,
       CASE c.label WHEN 'Chute' THEN 'Aidé à se relever, infirmière avisée.' ELSE 'Rassuré, raccompagné au lit.' END,
       c.label = 'Chute', false, t.ts + interval '15 minutes'
FROM residents r
JOIN note_categories c ON c.residence_id = r.residence_id AND c.label IN ('Chute', 'Sommeil')
CROSS JOIN generate_series(0, 3) AS m
CROSS JOIN LATERAL generate_series(1, (m + 1) * CASE c.label WHEN 'Chute' THEN 1 ELSE 2 END) AS k
-- « k * 0 » rend la sous-requête dépendante de k : sans ça, PostgreSQL ne
-- tire random() qu'une fois par mois et crée des notes en double, à la même minute.
CROSS JOIN LATERAL (
  SELECT date_trunc('month', now()) - (3 - m) * interval '1 month'
         + (random() * 25 + k * 0) * interval '1 day' + interval '2 hours' + (random() * 3) * interval '1 hour' AS ts
) AS t
WHERE r.last_name = 'Bélanger' AND t.ts < now();

-- ---------------------------------------------------------------------
-- Messagerie : canaux Équipe et Annonces, une conversation privée, un groupe
-- ---------------------------------------------------------------------
INSERT INTO conversations (residence_id, kind, title)
VALUES ('00000000-0000-4000-8000-000000000001', 'team', 'Toute l''équipe'),
       ('00000000-0000-4000-8000-000000000001', 'announcements', 'Annonces')
ON CONFLICT DO NOTHING;

WITH u AS (
  SELECT email, id FROM users WHERE residence_id = '00000000-0000-4000-8000-000000000001'
), direct AS (
  INSERT INTO conversations (residence_id, kind, direct_key, created_by)
  SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'direct',
         least(a.id::text, b.id::text) || ':' || greatest(a.id::text, b.id::text), a.id
  FROM u a, u b WHERE a.email = 'prepose1@exemple.test' AND b.email = 'prepose2@exemple.test'
  RETURNING id
), grp AS (
  INSERT INTO conversations (residence_id, kind, title, created_by)
  SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'group', 'Équipe de nuit', id FROM u WHERE email = 'infirmiere@exemple.test'
  RETURNING id
), members AS (
  INSERT INTO conversation_members (residence_id, conversation_id, user_id, added_by)
  SELECT '00000000-0000-4000-8000-000000000001'::uuid, d.id, u.id, NULL::uuid FROM direct d, u
  WHERE u.email IN ('prepose1@exemple.test', 'prepose2@exemple.test')
  UNION ALL
  SELECT '00000000-0000-4000-8000-000000000001'::uuid, g.id, u.id, NULL::uuid FROM grp g, u
  WHERE u.email IN ('infirmiere@exemple.test', 'prepose2@exemple.test', 'prepose4@exemple.test')
  RETURNING 1
), msgs(conv, email, body, ago) AS (
  VALUES
    ('team', 'responsable@exemple.test', 'Bonjour à tous ! Rappel : la réunion d''équipe est jeudi à 14 h, salle commune.', interval '26 hours'),
    ('team', 'prepose3@exemple.test', 'Merci, j''y serai.', interval '25 hours'),
    ('team', 'prepose1@exemple.test', 'Le lève-personne du 2e est réparé.', interval '3 hours'),
    ('announcements', 'responsable@exemple.test', 'Nouvelle procédure de lavage des mains affichée près de chaque poste. À lire avant votre prochain quart.', interval '20 hours'),
    ('direct', 'prepose1@exemple.test', 'Salut Fatou, peux-tu me remplacer samedi soir ?', interval '5 hours'),
    ('direct', 'prepose2@exemple.test', 'Oui, pas de problème. Je préviens Sophie.', interval '4 hours'),
    ('group', 'infirmiere@exemple.test', 'Cette nuit : surveiller la chambre 110 aux deux heures.', interval '9 hours'),
    ('group', 'prepose4@exemple.test', 'Bien noté.', interval '8 hours')
)
INSERT INTO messages (residence_id, conversation_id, author_id, body, created_at)
SELECT '00000000-0000-4000-8000-000000000001'::uuid,
       CASE m.conv WHEN 'direct' THEN (SELECT id FROM direct) WHEN 'group' THEN (SELECT id FROM grp)
         ELSE (SELECT id FROM conversations WHERE residence_id = '00000000-0000-4000-8000-000000000001' AND kind = m.conv) END,
       u.id, m.body, now() - m.ago
FROM msgs m JOIN u ON u.email = m.email
WHERE (SELECT count(*) FROM members) > 0;

UPDATE conversations c SET last_message_at = (SELECT max(created_at) FROM messages m WHERE m.conversation_id = c.id)
WHERE c.residence_id = '00000000-0000-4000-8000-000000000001';

-- Chaque auteur a lu sa conversation jusqu'à son propre message
INSERT INTO conversation_reads (residence_id, conversation_id, user_id, last_read_at)
SELECT residence_id, conversation_id, author_id, max(created_at) FROM messages GROUP BY 1, 2, 3
ON CONFLICT (conversation_id, user_id) DO NOTHING;

-- Comptes fictifs « anciens » : ils datent d'avant les messages et annonces
-- de démonstration (une annonce antérieure à l'arrivée d'un employé ne lui
-- est pas demandée).
UPDATE users SET created_at = now() - interval '1 year'
WHERE residence_id = '00000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------
-- Deuxième résidence, plus petite : pour le tableau de bord de la
-- plateforme (plusieurs résidences). Une responsable, un préposé,
-- quatre résidents, quelques notes.
-- ---------------------------------------------------------------------
INSERT INTO residences (id, name, type)
VALUES ('00000000-0000-4000-8000-000000000002', 'Manoir du Fleuve (fictif)', 'RI');

INSERT INTO users (residence_id, email, password_hash, first_name, last_name, role, created_at) VALUES
  ('00000000-0000-4000-8000-000000000002', 'responsable2@exemple.test', '!seed', 'Lucie', 'Martin',  'responsable', now() - interval '6 months'),
  ('00000000-0000-4000-8000-000000000002', 'prepose5@exemple.test',     '!seed', 'Hugo',  'Bernard', 'prepose',     now() - interval '6 months');

INSERT INTO note_categories (residence_id, label, sort_order)
SELECT '00000000-0000-4000-8000-000000000002', label, ord
FROM unnest(ARRAY['Comportement','Alimentation','Sommeil','Chute','Visite','Santé','Hygiène','Activité'])
     WITH ORDINALITY AS t(label, ord);

INSERT INTO shift_types (residence_id, label, start_time, end_time, sort_order) VALUES
  ('00000000-0000-4000-8000-000000000002', 'Jour', '07:00', '15:00', 1),
  ('00000000-0000-4000-8000-000000000002', 'Soir', '15:00', '23:00', 2),
  ('00000000-0000-4000-8000-000000000002', 'Nuit', '23:00', '07:00', 3);

INSERT INTO conversations (residence_id, kind, title) VALUES
  ('00000000-0000-4000-8000-000000000002', 'team', 'Toute l''équipe'),
  ('00000000-0000-4000-8000-000000000002', 'announcements', 'Annonces');

INSERT INTO residents (residence_id, first_name, last_name, room, admitted_at) VALUES
  ('00000000-0000-4000-8000-000000000002', 'Rosaire',   'Pelletier', '1', current_date - 400),
  ('00000000-0000-4000-8000-000000000002', 'Ginette',   'Lavoie',    '2', current_date - 250),
  ('00000000-0000-4000-8000-000000000002', 'Aurèle',    'Bouchard',  '3', current_date - 120),
  ('00000000-0000-4000-8000-000000000002', 'Thérèse',   'Côté',      '4', current_date - 60);

INSERT INTO notes (residence_id, author_id, resident_id, category_id, occurred_at, description, created_at)
SELECT r.residence_id, u.id, r.id, c.id, now() - (n || ' days')::interval,
       'Note de démonstration ' || n || '.', now() - (n || ' days')::interval
FROM residents r
JOIN users u ON u.email = 'prepose5@exemple.test'
JOIN note_categories c ON c.residence_id = r.residence_id AND c.label = 'Activité'
CROSS JOIN generate_series(1, 3) AS n
WHERE r.residence_id = '00000000-0000-4000-8000-000000000002';

-- L'auteur de chaque note l'a lue (comme l'API à la création d'une note)
INSERT INTO note_reads (residence_id, note_id, user_id, read_at)
SELECT residence_id, id, author_id, created_at FROM notes
ON CONFLICT (note_id, user_id) DO NOTHING;

COMMIT;

SELECT
  (SELECT count(*) FROM users)      AS employes,
  (SELECT count(*) FROM residents)  AS residents,
  (SELECT count(*) FROM notes)      AS notes,
  (SELECT count(*) FROM follow_ups) AS suivis;
