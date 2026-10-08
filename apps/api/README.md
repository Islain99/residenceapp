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
| `POST /auth/login` | `{ email, password }` | `{ accessToken, refreshToken, expiresIn, user }` |
| `POST /auth/refresh` | `{ refreshToken }` | `{ accessToken, refreshToken, expiresIn }` |
| `POST /auth/logout` | `{ refreshToken }` | 204 |
| `GET /auth/me` | — (`Authorization: Bearer <accessToken>`) | profil |
| `GET /health` | — | `{ status, db }` (503 si la base ne répond pas) |

- **Mots de passe** : Argon2id. Un courriel inconnu, un mauvais mot de passe ou un compte désactivé donnent la même réponse 401, dans le même temps.
- **Jeton d'accès** : JWT HS256 de 15 min, contient `sub` (utilisateur), `rid` (résidence) et `role`. Sans jeton ou jeton invalide : 401 `unauthorized` ; jeton expiré : 401 `token_expired` (le client appelle alors `/auth/refresh`).
- **Jeton de rafraîchissement** : 30 jours, à usage unique (remplacé à chaque `/auth/refresh`), stocké haché. Un jeton déjà utilisé présenté de nouveau révoque toutes les sessions de l'utilisateur (vol probable).
- **Limite** : 10 tentatives de connexion par minute et par adresse IP (429 au-delà).
- **Audit** : `login`, `login_failed` (avec le motif), `logout`, `refresh_reuse` dans `audit_log`.

## Journal de bord

Toutes les routes exigent un jeton et ne voient que **la résidence de l'utilisateur** (une note d'une autre résidence répond 404 ; l'admin plateforme, sans résidence, reçoit 403).

| Route | Rôle |
| --- | --- |
| `GET /note-categories` | Catégories actives, dans l'ordre d'affichage |
| `GET /notes` | Liste, la plus récente d'abord. Filtres : `residentId`, `categoryId`, `from`, `to`, `priority`, `status` (`active` par défaut, `annulee`, `all`), `q` (recherche plein texte, sans accents). Pagination : `limit` (50, max 100) et `cursor` (= `nextCursor` de la page précédente) |
| `GET /notes/:id` | Une note + l'historique de ses corrections (`versions`) |
| `POST /notes` | Nouvelle note : `occurredAt`, `categoryId`, `description`, et en option `residentId` (absent = note générale), `intervention`, `isPriority`, `isPositive` |
| `PATCH /notes/:id` | Correction des champs envoyés ; l'ancienne version est conservée |
| `POST /notes/:id/cancel` | Annulation avec `reason` (la note reste visible, statut `annulee`) |

Règles :

- Tous les rôles écrivent des notes ; l'auteur est l'utilisateur connecté.
- Corriger ou annuler : **l'auteur pendant 24 h**, une **infirmière ou responsable** en tout temps. Une note annulée ne change plus (409).
- Rien n'est supprimé. Création, correction, annulation et consultation d'une note sont inscrites dans `audit_log`.
- `occurredAt` ne peut pas être dans le futur (5 min de tolérance).

## Protéger une route

```ts
import { authenticate, requireRole } from '../auth.js';

app.get('/notes', { preHandler: authenticate }, async (request) => {
  // request.user = { sub, rid, role } ; toujours filtrer par request.user.rid
});
app.post('/residents', { preHandler: requireRole('infirmiere', 'responsable') }, handler);
```
