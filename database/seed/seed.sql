-- =====================================================================
-- seed.sql — Données FICTIVES pour le développement et les démos.
-- Ne jamais exécuter en production.
--   1 résidence, 6 employés + 1 admin, 15 résidents, 8 catégories,
--   environ un mois de notes, des suivis, des relèves.
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

COMMIT;

SELECT
  (SELECT count(*) FROM users)      AS employes,
  (SELECT count(*) FROM residents)  AS residents,
  (SELECT count(*) FROM notes)      AS notes,
  (SELECT count(*) FROM follow_ups) AS suivis;
