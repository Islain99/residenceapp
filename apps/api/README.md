# API

Fastify 5 + TypeScript. Accès à la base avec [Kysely](https://kysely.dev) : le schéma est défini par les migrations SQL de `database/`, les types TypeScript en sont générés (`src/db/types.ts`).

## Démarrage

Prérequis : Node.js 22+, la base démarrée (`database/`, voir son README).

```bash
cd apps/api
cp .env.example .env          # DATABASE_URL (compte app_user) et JWT_SECRET
npm install
npm run seed:passwords        # comptes fictifs → mot de passe Residence2026!
npm run dev                   # http://127.0.0.1:3000
```

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur avec rechargement automatique |
| `npm test` | Tests d'intégration. Recrée d'abord la base `residence_test` (migrations + données fictives, ~3 s) dans le conteneur `pg-primary` ; la base de développement n'est jamais touchée. Docker doit tourner |
| `npm run typecheck` | Vérification des types |
| `npm run build` puis `npm start` | Version compilée (`dist/`) |
| `npm run db:types` | Régénérer `src/db/types.ts` **après chaque migration** |

## Authentification

| Route | Corps | Réponse |
| --- | --- | --- |
| `POST /auth/login` | `{ email, password, session? }` | `{ accessToken, refreshToken, expiresIn, user }` |
| `POST /auth/refresh` | `{ refreshToken }` (ou `{}` + cookie) | `{ accessToken, refreshToken, expiresIn }` |
| `POST /auth/logout` | `{ refreshToken }` (ou `{}` + cookie) | 204 |
| `GET /staff` | — | Employés actifs de ma résidence (`id`, nom, rôle), pour assigner un suivi |
| `GET /auth/me` | — (`Authorization: Bearer <accessToken>`) | profil |
| `GET /health` | — | `{ status, db }` (503 si la base ne répond pas) |

- **Mots de passe** : Argon2id. Un courriel inconnu, un mauvais mot de passe ou un compte désactivé donnent la même réponse 401, dans le même temps.
- **Jeton d'accès** : JWT HS256 de 15 min, contient `sub` (utilisateur), `rid` (résidence) et `role`. Sans jeton ou jeton invalide : 401 `unauthorized` ; jeton expiré : 401 `token_expired` (le client appelle alors `/auth/refresh`).
- **Jeton de rafraîchissement** : 30 jours, à usage unique (remplacé à chaque `/auth/refresh`), stocké haché. Un jeton déjà utilisé présenté de nouveau révoque toutes les sessions de l'utilisateur (vol probable).
- **Mode cookie (navigateur)** : `session: "cookie"` à la connexion → le jeton de rafraîchissement est posé dans un cookie `httpOnly`, `SameSite=Strict` (`Secure` en production) et n'apparaît pas dans la réponse ; `/auth/refresh` et `/auth/logout` le lisent dans le cookie. Le site doit être servi sur la même origine que l'API (proxy `/api`). Sans `session` (mode `token`, application mobile) : jeton dans le corps, comme avant.
- **Limite** : 10 tentatives de connexion par minute et par adresse IP (429 au-delà).
- **Audit** : `login`, `login_failed` (avec le motif), `logout`, `refresh_reuse` dans `audit_log`.

## Journal de bord

Toutes les routes exigent un jeton et ne voient que **la résidence de l'utilisateur** (une note d'une autre résidence répond 404 ; l'admin plateforme, sans résidence, reçoit 403).

| Route | Rôle |
| --- | --- |
| `GET /note-categories` | Catégories actives, dans l'ordre d'affichage |
| `GET /notes` | Liste, la plus récente d'abord. Filtres : `residentId`, `categoryId`, `from`, `to`, `priority`, `status` (`active` par défaut, `annulee`, `all`), `q` (recherche plein texte, sans accents). Pagination : `limit` (50, max 100) et `cursor` (= `nextCursor` de la page précédente) |
| `GET /notes/:id` | Une note + l'historique de ses corrections (`versions`), ses suivis (`followUps`) et qui l'a lue (`reads`) |
| `POST /notes/:id/read` | Confirmer la lecture (204 ; répéter n'a pas d'effet). Chaque note porte `readByMe` ; filtre `GET /notes?unread=true` |
| `POST /notes` | Nouvelle note : `occurredAt`, `categoryId`, `description`, et en option `residentId` (absent = note générale), `intervention`, `isPriority`, `isPositive` |
| `PATCH /notes/:id` | Correction des champs envoyés ; l'ancienne version est conservée |
| `POST /notes/:id/cancel` | Annulation avec `reason` (la note reste visible, statut `annulee`) |

Règles :

- Tous les rôles écrivent des notes ; l'auteur est l'utilisateur connecté.
- Corriger ou annuler : **l'auteur pendant 24 h**, une **infirmière ou responsable** en tout temps. Une note annulée ne change plus (409).
- Rien n'est supprimé. Création, correction, annulation et consultation d'une note sont inscrites dans `audit_log`.
- `occurredAt` ne peut pas être dans le futur (5 min de tolérance).

## Suivis

Actions à faire issues d'une note. Tous les rôles les créent, modifient et ferment ; un suivi fermé ne change plus (409).

| Route | Rôle |
| --- | --- |
| `GET /follow-ups` | Ouverts par défaut, échéance la plus proche d'abord. Filtres : `status` (`open`, `closed`, `all`), `assignedTo` (`me`, `team` = sans assignation, ou un identifiant), `residentId`. Chaque suivi porte `isOverdue` |
| `GET /follow-ups/:id` | Un suivi |
| `POST /notes/:id/follow-ups` | `{ description, assignedTo?, dueAt? }` sur une note active (sans `assignedTo` : toute l'équipe) |
| `PATCH /follow-ups/:id` | Description, assignation, échéance |
| `POST /follow-ups/:id/close` | `{ closingNote? }` |

## Relève de quart

| Route | Rôle |
| --- | --- |
| `GET /handover` | Notes actives écrites depuis ma dernière relève (24 h si aucune), prioritaires d'abord, compteurs (`notes`, `priority`, `unread`) et suivis ouverts assignés à moi ou à l'équipe |
| `POST /handover/ack` | `{ seenUntil }` = le `generatedAt` reçu du `GET` : la relève suivante part de là, une note écrite entre la lecture et la confirmation n'est pas perdue |

Les heures de relève viennent de l'horloge de la base (même horloge que `created_at` des notes).

## Résidents

| Route | Rôle |
| --- | --- |
| `GET /residents` | Actifs par défaut (`status` : `actif`, `parti`, `all`), tri français par nom ; `q` cherche dans le nom (sans accents) ou la chambre |
| `GET /residents/:id` | Fiche (consultation auditée). `restrictedNotes` seulement pour une infirmière ou une responsable |
| `POST /residents` | Infirmière, responsable : `{ firstName, lastName, room?, birthDate?, emergencyContact?, specialInstructions?, restrictedNotes?, admittedAt? }` (dates `AAAA-MM-JJ`) |
| `PATCH /residents/:id` | Infirmière, responsable. Départ : `{ status: "parti", leftAt }` ; retour : `{ status: "actif" }` |

Aucune suppression de résident.

## Comptes des employés et mot de passe

Personne d'autre que l'employé ne connaît son mot de passe : la responsable l'invite, il le choisit lui-même à partir d'un lien reçu par courriel.

| Route | Rôle |
| --- | --- |
| `GET /users` | Responsable : comptes de la résidence, avec `status` (`invited`, `active`, `inactive`) |
| `POST /users` | Responsable : `{ email, firstName, lastName, role }` (`prepose`, `infirmiere`, `responsable`) → courriel d'invitation, lien valable 72 h. Si le courriel ne part pas, rien n'est créé (502) |
| `POST /users/:id/invite` | Responsable : renvoyer l'invitation (l'ancien lien ne vaut plus rien) |
| `PATCH /users/:id` | Responsable : `firstName`, `lastName`, `role`, `isActive`. Désactiver ferme ses sessions tout de suite. Pas sur son propre rôle ni sa propre désactivation |
| `POST /auth/password/forgot` | `{ email }` → 204 **dans tous les cas** (ne révèle pas qui a un compte) ; lien valable 1 h si le compte existe et est actif. 5 demandes / minute / IP |
| `POST /auth/password/check` | `{ token }` → `{ purpose, email, firstName }` ou 400 `invalid_token` |
| `POST /auth/password/reset` | `{ token, password }` (10 caractères minimum, pas le courriel) → 204 ; toutes les sessions de l'employé sont fermées |

- Liens à usage unique : un nouveau lien annule les précédents ; seul le SHA-256 est stocké (`account_tokens`).
- Le lien est `APP_URL/mot-de-passe#<jeton>` : le jeton est dans le fragment, jamais envoyé à un serveur ni noté dans un journal.
- Un compte invité n'a pas de mot de passe (`password_hash` NULL) : connexion refusée avec le message habituel.
- Audit : `create`, `invite`, `account_activated`, `password_reset_requested`, `password_reset`, `deactivate`, `reactivate`, `update`.
- Courriels : `SMTP_URL`, `MAIL_FROM`, `APP_URL` (voir `.env.example`). En développement, Mailpit (http://localhost:8025) reçoit tout, rien ne part pour vrai. Les tests gardent les courriels en mémoire.

## Protéger une route

```ts
import { authenticate, requireRole } from '../auth.js';

app.get('/notes', { preHandler: authenticate }, async (request) => {
  // request.user = { sub, rid, role } ; toujours filtrer par request.user.rid
});
app.post('/residents', { preHandler: requireRole('infirmiere', 'responsable') }, handler);
```
