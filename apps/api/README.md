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
| `npm run db:setup` | Préparer une base hébergée (rôles, droits, migrations, données fictives) : voir « Déploiement » |

## Déploiement de test : Railway (API + base) et Vercel (interface)

Phase de test seulement, **avec des données fictives** : Railway n'a pas de région au Canada. Au lancement officiel, migration vers AWS (`ca-central-1`) : le code ne change pas, seules les variables changent.

```
Navigateur ──► Vercel (apps/web, fichiers statiques)  ── /api/* relayé ──►  Railway : API  ──►  Railway : PostgreSQL
               même domaine pour l'interface et l'API                       npm start          (réseau privé)
```

Le navigateur ne voit qu'un seul domaine (celui de Vercel) : le cookie de session reste `SameSite=Strict` et aucune règle CORS n'est nécessaire.

### 1. Railway

1. Nouveau projet → **Deploy from GitHub repo** → ce dépôt. Ajouter **Database → PostgreSQL**.
2. Service de l'API → **Settings**. L'API est construite avec `apps/api/Dockerfile`, depuis la racine du dépôt : l'image contient aussi `database/migrations` et `database/seed`, lus par `db:setup`.

| Réglage | Valeur |
| --- | --- |
| Source → Branch | `main` (ou une branche à tester) |
| Root Directory | *(vide : la racine du dépôt)* |
| Variable `RAILWAY_DOCKERFILE_PATH` | `apps/api/Dockerfile` |
| Pre-deploy command | `npm run db:setup` |
| Start command | *(vide : celle du Dockerfile, `node dist/server.js`)* |
| Healthcheck path | `/health` |
| Watch paths | `/apps/api/**`, `/database/migrations/**`, `/database/seed/**` |
| Networking | *Generate Domain*, sur le port où l'API écoute : celui de la ligne `Server listening at http://[::]:<port>` des journaux (Railway fournit `PORT`, souvent 8080) |

3. Variables du service de l'API (*Raw Editor*). Générer `APP_DB_PASSWORD` et `JWT_SECRET` avec `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` :

```ini
RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile
NODE_ENV=production
HOST=::
TRUST_PROXY=2
APP_DB_PASSWORD=<64 caractères hexadécimaux>
DATABASE_URL=postgresql://app_user:${{APP_DB_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
DATABASE_ADMIN_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<64 caractères hexadécimaux, différent>
APP_URL=https://<projet>.vercel.app
RESEND_API_KEY=<clé d'API Resend>          # ou BREVO_API_KEY=<clé d'API Brevo>
MAIL_FROM=Journal de bord <no-reply@<domaine vérifié chez le fournisseur>>
SEED_DEMO=true
SEED_PASSWORD=<mot de passe des comptes fictifs, 12 caractères min.>
MFA_ENCRYPTION_KEY=<64 caractères hexadécimaux, encore différent>
VAPID_PUBLIC_KEY=<npx web-push generate-vapid-keys>
VAPID_PRIVATE_KEY=<idem>
VAPID_SUBJECT=mailto:<adresse de contact>
```

`MFA_ENCRYPTION_KEY` chiffre les secrets de double authentification ; sans elle, la clé est dérivée de `JWT_SECRET` (changer `JWT_SECRET` obligerait alors chaque responsable à reconfigurer son application). Ne plus la changer une fois des comptes configurés. Sans clés VAPID, les notifications push sont simplement désactivées.

`PORT` est fourni par Railway. `HOST=::` : l'API écoute en IPv6 et en IPv4 ; avec `0.0.0.0` (IPv4 seulement), le test de santé de Railway échoue. **Courriels** : Railway bloque le SMTP sortant (sauf plan Pro) ; l'API envoie donc par l'API HTTPS de Resend (`RESEND_API_KEY`) ou de Brevo (`BREVO_API_KEY`), prioritaires sur `SMTP_URL`. Le domaine de `MAIL_FROM` doit être vérifié chez le fournisseur (enregistrements DNS SPF/DKIM qu'il indique). Vérification : Plateforme › Sécurité › « M'envoyer un courriel d'essai » (`POST /platform/email/test`). En cas d'échec, la cause (clé, domaine) est dans le journal de l'API (« envoi de courriel »). Sans envoi, inviter un employé, créer une résidence ou « mot de passe oublié » échouent (502), rien n'est créé. Au premier déploiement, `db:setup` crée les rôles (`app_migrator`, `app_user`, `app_readonly`), applique les migrations et charge les données fictives ; ensuite, il applique seulement les nouvelles migrations. L'API se connecte toujours en `app_user` (aucun DELETE, audit en ajout seul) ; le compte administrateur ne sert qu'à l'étape *pre-deploy*.

`TRUST_PROXY=2` : Vercel puis le proxy de Railway sont devant l'API. Sans ce réglage, toutes les requêtes sembleraient venir de la même adresse, et la limite de connexions par IP s'appliquerait à toutes les résidences ensemble.

4. Vérifier : `https://<api>.up.railway.app/health` → `{"status":"ok","db":"ok"}`.

### 2. Vercel

1. **Add New → Project** → ce dépôt. *Root Directory* : `apps/web` (framework Vite détecté).
2. `apps/web/vercel.json` relaie vers `residenceapp-production.up.railway.app`. Si le domaine Railway change, le modifier dans ce fichier (Vercel ne lit pas de variables d'environnement dans `vercel.json`).
3. Ouvrir `https://<projet>.vercel.app` et se connecter avec un compte fictif (`SEED_PASSWORD`).

`vercel.json` relaie `/api/*` vers l'API (en retirant `/api`, comme le proxy de Vite en développement), renvoie les autres adresses vers `index.html` (routes de l'interface), et ajoute des en-têtes de sécurité (`Permissions-Policy` : micro autorisé pour le site lui-même seulement, pour la dictée des notes ; caméra et position refusées). `sw.js` n'est jamais mis en cache par le navigateur, pour que les mises à jour de l'application arrivent tout de suite.

### 3. Passage à AWS (lancement officiel)

Mêmes commandes : `npm run db:setup` (`DATABASE_ADMIN_URL` = compte maître RDS : pas besoin d'être superutilisateur) puis `npm start`. Ajouter `?sslmode=verify-full` et le certificat RDS à `DATABASE_URL`, mettre `SEED_DEMO=false`, ajuster `TRUST_PROXY` au nombre de proxys devant l'API (ex. 1 derrière un seul équilibreur de charge), et ne garder le compte administrateur que dans l'étape de migration.

## Vérification automatique (GitHub Actions)

`.github/workflows/ci.yml`, à chaque push sur `main` et à chaque pull request :

- **Interface** : `npm run lint`, puis `npm run build` (types + version de production).
- **API** : démarre `pg-primary` (Docker), types, build, tests d'intégration, puis `db:setup` deux fois sur une base vide (comme un premier déploiement Railway, puis un redéploiement).

## Authentification

| Route | Corps | Réponse |
| --- | --- | --- |
| `POST /auth/login` | `{ email, password, session?, sharedDevice? }` | `{ accessToken, refreshToken, expiresIn, user }` ; responsable et admin : `{ mfa: "required" \| "setup", mfaToken, expiresIn }` |
| `POST /auth/mfa/verify` | `{ mfaToken, code }` (6 chiffres ou code de secours) | comme `/auth/login`, + `backupCodesRemaining` |
| `POST /auth/mfa/setup` | `{ mfaToken }` (première fois) | `{ secret, otpauthUrl, qrSvg }` |
| `POST /auth/mfa/enable` | `{ mfaToken, code }` | comme `/auth/login`, + `backupCodes` (10, affichés une seule fois) |
| `GET /auth/mfa` | — | `{ required, enabled, enabledAt, backupCodesRemaining }` |
| `POST /auth/mfa/backup-codes` | `{ code }` (6 chiffres) | `{ backupCodes }` : nouvelle série, l'ancienne ne vaut plus rien |
| `POST /auth/refresh` | `{ refreshToken }` (ou `{}` + cookie) | `{ accessToken, refreshToken, expiresIn }` |
| `POST /auth/logout` | `{ refreshToken }` (ou `{}` + cookie) | 204 |
| `GET /staff` | — | Employés actifs de ma résidence (`id`, nom, rôle), pour assigner un suivi |
| `PATCH /auth/me` | `{ firstName?, lastName?, phone?, avatar?, avatarColor? }` | Mon profil, comme `GET /auth/me`. `phone` : chiffres, espaces, `+ ( ) . -`, 7 à 30 caractères (vide ou `null` : retiré). `avatar` : avatar illustré de la galerie, `lorelei:<nom>` ou `notionists:<nom>` (minuscules ; dessiné par l'interface, aucune image stockée ; `null` : initiales). `avatarColor` : `teal`, `blue`, `indigo`, `violet`, `pink`, `red`, `orange`, `green`, `slate` (`null` : couleur tirée de l'id). Courriel et rôle : non modifiables ici. Audité (`profile_update`, noms des champs seulement) |
| `POST /auth/password/change` | `{ currentPassword, newPassword, signOutOthers? }` | `{ otherSessionsClosed }`. Mot de passe actuel exigé ; un mauvais compte dans le blocage du compte (comme à la connexion). Nouveau : 12 caractères au moins, différent de l'actuel et du courriel. `signOutOthers` (vrai par défaut) : les sessions des autres appareils **expirent** (pas révoquées : l'autre appareil voit « session expirée » sans déclencher l'alerte de vol), celle de cet appareil reste (cookie, ou `refreshToken` en mode jeton). Courriel d'avis à la personne. Audité (`password_change`, `password_change_failed`) |
| `GET /auth/me` | — (`Authorization: Bearer <accessToken>`) | profil |
| `GET /health` | — | `{ status, db }` (503 si la base ne répond pas) |

- **Mots de passe** : Argon2id. Un courriel inconnu, un mauvais mot de passe ou un compte désactivé donnent la même réponse 401, dans le même temps.
- **Jeton d'accès** : JWT HS256 de 15 min, contient `sub` (utilisateur), `rid` (résidence) et `role`. Sans jeton ou jeton invalide : 401 `unauthorized` ; jeton expiré : 401 `token_expired` (le client appelle alors `/auth/refresh`).
- **Jeton de rafraîchissement** : 12 h (`REFRESH_TOKEN_TTL_HOURS`), à usage unique (remplacé à chaque `/auth/refresh`), stocké haché. Un jeton déjà utilisé présenté de nouveau révoque toutes les sessions de l'utilisateur (vol probable). Exception : un jeton remplacé il y a moins de 30 s (deux rechargements rapprochés, réponse perdue en route) redonne simplement une session (`refresh_tokens.rotated_at`).
- **Double authentification** (responsables, admins — obligatoire) : après le bon mot de passe, l'API ne remet qu'un jeton d'étape 2 (10 min, n'ouvre aucune route). Code TOTP à 6 chiffres (RFC 6238 : Google Authenticator, Microsoft Authenticator…), un pas de 30 s de tolérance, jamais deux fois le même code ; ou un des 10 codes de secours (hachés, usage unique). Les mauvais codes comptent dans le blocage du compte (5 essais). Le secret est chiffré en base (AES-256-GCM). Première connexion : code QR, confirmation, codes de secours. Un employé nommé responsable doit se reconnecter et la configurer. Téléphone et codes perdus : un admin la réinitialise (`POST /platform/users/:id/reset-mfa`) ; pour le dernier admin, `npm run mfa:reset -- <courriel>` sur le serveur.
- **Mode cookie (navigateur)** : `session: "cookie"` à la connexion → le jeton de rafraîchissement est posé dans un cookie `httpOnly`, `SameSite=Strict` (`Secure` en production) et n'apparaît pas dans la réponse ; `/auth/refresh` et `/auth/logout` le lisent dans le cookie. Le site doit être servi sur la même origine que l'API (proxy `/api`). Sans `session` (mode `token`, application mobile) : jeton dans le corps, comme avant.
- **Appareil partagé** : `sharedDevice: true` à la connexion → le cookie est un cookie de session (effacé à la fermeture du navigateur), y compris après chaque `/auth/refresh`.
- **Blocage par compte** : 5 mauvais mots de passe d'affilée (`LOGIN_MAX_ATTEMPTS`) bloquent le compte 15 min (`LOGIN_LOCK_MINUTES`), quelle que soit l'adresse IP : 429 `account_locked`, même avec le bon mot de passe. Une connexion réussie ou un nouveau mot de passe (lien « mot de passe oublié ») remet le compteur à zéro. Un courriel inconnu ne bloque rien et répond toujours 401. Seul effet visible de l'extérieur : après 5 essais, un compte existant répond 429 au lieu de 401.
- **Limite par adresse IP** : 30 requêtes de connexion par minute (`LOGIN_RATE_LIMIT_MAX`, 429 `too_many_requests`). Large exprès : tout le personnel d'une résidence passe souvent par le même Wi-Fi.
- **Compte relu à chaque requête** : un compte désactivé perd l'accès immédiatement (401 `inactive_account`), sans attendre la fin du jeton d'accès ; un changement de rôle s'applique aussi tout de suite.
- **Audit** : `login` (avec `mfa` : `totp`, `backup`, `setup`), `login_failed` (avec le motif : `bad_password`, `bad_mfa_code`, `locked`…), `logout`, `refresh_reuse`, `mfa_enabled`, `mfa_backup_codes`, `mfa_reset` dans `audit_log`.

## Langue (français / anglais)

`users.locale` (`fr` par défaut, ou `en`, migration 0013) : renvoyé à la connexion et par `/auth/me`, modifiable par `PATCH /auth/me { locale }`. À l'invitation, la responsable (ou l'administration de la plateforme) choisit la langue de la personne (`locale` dans `POST /users`, `POST /platform/residences`, `POST /platform/residences/:id/responsables`, `POST /platform/admins`).

- **Courriels** (invitation, mot de passe oublié, mot de passe changé, essai) et **notifications push** partent dans la langue du destinataire. Textes : `src/lib/locale.ts` (`MAIL_TEXT`, `PUSH_TEXT`) ; le type `Localized<T>` exige les deux langues.
- **Messages d'erreur** : en français ; l'interface en anglais les traduit d'après leur code (`apps/web/src/i18n/api-errors.ts`). `test/i18n.test.ts` vérifie que chaque code a sa traduction.

## Notifications push

Web Push (service worker de l'interface), si les clés VAPID sont configurées. **Aucun contenu** dans une notification (elle s'affiche sur l'écran verrouillé) : le type d'événement et l'auteur seulement, jamais le nom d'un résident ni le texte d'une note ou d'un message.

| Événement | Qui reçoit | Exemple |
| --- | --- | --- |
| Message privé, de groupe ou d'équipe | Membres, sauf l'auteur | « Message de Marc T. » |
| Annonce | Toute l'équipe active | « Annonce de Sophie G. » |
| Consigne prioritaire (créée, ou note devenue prioritaire) | Employés en quart selon l'horaire (30 min avant le début jusqu'à la fin) ; sans horaire ce jour-là : toute l'équipe | « Consigne prioritaire » |
| Suivi confié à quelqu'un d'autre | La personne assignée | « Suivi assigné » |
| Échéance d'un suivi (dans les 30 min) | La personne assignée, sinon l'équipe en quart ; une fois (une nouvelle échéance relance un rappel) | « Suivi à échéance » |

| Route | Rôle |
| --- | --- |
| `GET /push/config` | `{ enabled, publicKey }` |
| `POST /push/subscriptions` | `{ endpoint, keys: { p256dh, auth } }` : abonner cet appareil. Seuls les services des navigateurs sont acceptés (FCM, Mozilla, Microsoft, Apple) |
| `POST /push/subscriptions/unsubscribe` | `{ endpoint }` (l'interface l'appelle aussi à la déconnexion) |
| `GET /push/preferences` · `PATCH /push/preferences` | `messages`, `announcements`, `priorityNotes`, `followUps` (tous activés par défaut) ; `devices` |
| `POST /push/test` | Notification d'essai sur mes appareils |

L'envoi se fait après la réponse (une notification qui échoue ne fait pas échouer l'action). Abonnement expiré (404/410) : désactivé ; 5 échecs de suite : désactivé. Rappels d'échéance vérifiés toutes les 5 min (`PUSH_REMINDER_INTERVAL_SECONDS`), sans double envoi même avec plusieurs instances de l'API.

## Fonctionnalités activables

L'administration de la plateforme règle, pour chaque résidence, le niveau d'accès de chaque module : `off` (masqué), `read` (consultation), `full` (complet). Catalogue, plafonds des rôles, dépendances et formules : `src/lib/features.ts` (migration 0014).

Niveau effectif d'une personne : son exception (`user_features`) si elle en a une, sinon le réglage de son rôle (`residence_features`), sinon la valeur par défaut (le comportement d'avant) ; ramené au plafond du rôle (un réglage ne donne jamais plus que le rôle), puis par les dépendances (Journal masqué → Relève, Dictée, Consignes et Statistiques masquées ; Résidents masqués → Statistiques masquées ; Annonces sans Messagerie ni Relève → masquées).

| Module | Préposé·e | Infirmière | Responsable | Niveaux |
| --- | --- | --- | --- | --- |
| `handover` Relève | full | full | full | off · full |
| `journal` Journal | full | full | full | off · read · full |
| `priority` Consignes prioritaires | — | full | full | off · full |
| `followUps` Suivis | full | full | full | off · read · full |
| `messaging` Messagerie | full | full | full | off · full |
| `announcements` Annonces | read | full | full | off · read · full |
| `agenda` Agenda | full | full | full | off · read · full |
| `schedule` Horaires | read | read | full | off · read · full |
| `residents` Résidents | read | full | full | off · read · full |
| `stats` Statistiques | — | read | read | off · read |
| `dictation` Dictée | full | full | full | off · full |

Le tableau de bord de la plateforme indique la formule de chaque résidence (`formula` dans `GET /platform/residences`).

Une exception suit la personne : si son rôle change (responsable, ou plateforme qui nomme un employé responsable), ses exceptions sont retirées d'office et le retrait est tracé (`feature_exception_revoke`, motif `role_changed`).

Toujours actifs : journal d'audit, export d'un dossier (Loi 25), gestion de l'équipe, Mon profil, Aide. Formules : `complete` (par défaut), `essential` (sans Agenda, Horaires, Messagerie ni Annonces), `nurseJournal` (préposés : Journal en consultation, Résidents masqués) ; sinon `custom`.

| Route | Rôle |
| --- | --- |
| `GET /platform/residences/:id/features` | Admin plateforme : réglages, niveaux effectifs par rôle, catalogue (niveaux, plafonds, dépendances), formules, dernière modification |
| `PUT /platform/residences/:id/features` | Admin plateforme : `{ settings, acceptCascade? }`, la grille voulue (absent : défaut). `400 invalid_level` (niveau impossible ou au-dessus du rôle), `400 unknown_feature`, `409 dependency_conflict` + `conflicts` (modules masqués par leurs dépendances ; renvoyer avec `acceptCascade: true`). Enregistre les niveaux effectifs, trace `feature_update` (avant → après) et prévient par courriel les responsables actives ; réponse : `changes`, `notified` |
| `PUT /platform/residences/:id/features/users/:userId` | Admin plateforme : exception pour une personne `{ feature, level, reason? }` (remplace celle en cours pour ce module). Refus : `invalid_user`, `invalid_level` (au-dessus du rôle), `exception_same_as_role`, `exception_blocked` (dépendance manquante). Tracé `feature_exception`, responsables prévenues ; réponse : la grille, `exceptions`, `notified` |
| `POST /platform/residences/:id/features/exceptions/:exceptionId/revoke` | Admin plateforme : retirer une exception (retour au niveau du rôle). Tracé `feature_exception_revoke`, responsables prévenues |
| `GET /features` | Tous les comptes d'une résidence (et l'accès d'assistance, avec les niveaux de la responsable) : `{ features: { journal: 'full', … }, locked }`. Admin hors assistance : 403 |
| `GET /features/residence` | Responsable : réglages de sa résidence par rôle, formule et exceptions en cours (lecture seule ; Admin › Fonctionnalités, Équipe) |

Réglages lus une fois par résidence et gardés 30 s en mémoire ; un changement fait par le même serveur s'applique tout de suite.

**Contrôle des routes** (`src/lib/feature-routes.ts`) : chaque route est rattachée à un module et à un niveau minimal (lecture → `read`, écriture → `full`), ou déclarée toujours active ; une route sans règle empêche l'API de démarrer. Vérifié dans `authenticate`, après la lecture du compte. Refus : `403 { error: 'feature_disabled' | 'feature_read_only', feature }`. Une exigence que le rôle ne peut pas atteindre est laissée au contrôle du rôle (même réponse qu'avant). Dans les routes :

- note prioritaire (création ou correction) : `priority` en Complet ;
- relève et détail d'une note : sections Suivis et Rendez-vous vides si le module est masqué pour la personne ;
- liste des résidents : permise avec Résidents, Journal, Agenda ou Suivis (pour choisir un résident) ; la fiche exige Résidents ;
- conversations : privées, groupes et fil d'équipe avec la Messagerie, canal des annonces avec les Annonces (publier : Annonces en Complet) ; une conversation d'un module masqué répond 404 ;
- notifications push : aucune pour un module masqué pour la personne (messages → Messagerie, annonces → Annonces, consignes → Journal, suivis → Suivis).

## Journal de bord

Toutes les routes exigent un jeton et ne voient que **la résidence de l'utilisateur** (une note d'une autre résidence répond 404 ; l'admin plateforme, sans résidence, reçoit 403).

| Route | Rôle |
| --- | --- |
| `GET /note-categories` | Catégories actives, dans l'ordre d'affichage |
| `GET /notes` | Liste, la plus récente d'abord. Filtres : `residentId`, `categoryId`, `from`, `to`, `priority`, `status` (`active` par défaut, `annulee`, `all`), `q` (recherche plein texte, sans accents). Pagination : `limit` (50, max 100) et `cursor` (= `nextCursor` de la page précédente) |
| `GET /notes/:id` | Une note + l'historique de ses corrections (`versions`), ses suivis (`followUps`), qui l'a lue (`reads`) et, pour une consigne prioritaire active, qui ne l'a pas encore lue (`unreadBy` : employés actifs) |
| `POST /notes/:id/read` | Confirmer la lecture (204 ; répéter n'a pas d'effet, sauf après une correction de fond : la relecture est enregistrée). Chaque note porte `readByMe`, `modifiedSinceRead` et `contentEditedAt` ; filtre `GET /notes?unread=true` |
| `POST /notes` | Nouvelle note : `occurredAt`, `categoryId`, `description`, et en option `residentId` (absent = note générale), `intervention`, `isPriority`, `isPositive` |
| `PATCH /notes/:id` | Correction des champs envoyés ; l'ancienne version est conservée |
| `POST /notes/:id/cancel` | Annulation avec `reason` (la note reste visible, statut `annulee`) |

Règles :

- Tous les rôles écrivent des notes ; l'auteur est l'utilisateur connecté.
- **Consigne prioritaire** (`isPriority`) : seulement une infirmière ou une responsable peut la marquer ou la retirer, à la création comme en correction (403 sinon). Un préposé peut corriger sa note si `isPriority` ne change pas.
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

« Je m'en occupe » dans l'interface = `PATCH /follow-ups/:id` avec `{ assignedTo: <mon id> }`. Tout le monde peut fermer un suivi (travail d'équipe) ; qui l'a fermé est enregistré et affiché, y compris dans le dossier du résident (« Suivis terminés récemment »).

## Lectures

- **L'auteur a lu sa note** (enregistré à la création).
- **Correction de fond** (texte, intervention, résident, heure, ou passage en consigne prioritaire) : `contentEditedAt` est mis à jour, et celui qui corrige a lu la nouvelle version.
  - Consigne prioritaire : les lectures antérieures ne comptent plus (`readByMe: false`, à relire ; `unreadBy` la liste) et elle revient dans la relève.
  - Note ordinaire : elle reste lue, avec `modifiedSinceRead: true` (« modifiée depuis votre lecture »).
  - Changer seulement la catégorie, « positif » ou retirer la priorité n'oblige personne à relire.
- Aucune lecture n'est supprimée (`app_user` n'a pas de DELETE) : la validité se calcule avec `contentEditedAt` (migration 0008).

## Relève de quart

| Route | Rôle |
| --- | --- |
| `GET /handover` | Notes actives écrites depuis ma dernière relève (24 h si aucune), prioritaires d'abord, compteurs (`notes`, `priority`, `unread`), suivis ouverts assignés à moi ou à l'équipe, et rendez-vous prévus des prochaines 24 h (`appointments`, y compris ceux commencés depuis moins d'une heure) |
| `POST /handover/ack` | `{ seenUntil }` = le `generatedAt` reçu du `GET` : la relève suivante part de là, une note écrite entre la lecture et la confirmation n'est pas perdue. **Les consignes prioritaires de la relève doivent être confirmées une à une avant** (sinon 409 `priority_unread`) ; la confirmation marque ensuite **lues toutes les notes ordinaires** de la relève |

Les heures de relève viennent de l'horloge de la base (même horloge que `created_at` des notes). Une consigne prioritaire corrigée depuis ma dernière relève y réapparaît, même si elle avait été écrite avant.

## Agenda

Rendez-vous d'un résident (médecin, transport, visite…) ou de la résidence (`residentId` absent : activité, réunion…).

| Route | Rôle |
| --- | --- |
| `GET /appointments` | Rendez-vous qui commencent dans `[from, to[` (92 jours au plus), du plus tôt au plus tard. Filtres : `residentId`, `kind`, `status` (`prevu` par défaut, `annule`, `all`) |
| `GET /appointments/:id` | Un rendez-vous |
| `POST /appointments` | `{ kind, title, startsAt, endsAt?, residentId?, location?, details? }`. `kind` : `medical`, `transport`, `visite`, `activite`, `reunion`, `autre` |
| `PATCH /appointments/:id` | Champs envoyés seulement |
| `POST /appointments/:id/cancel` | `{ reason }` : reste visible, statut `annule` |

- Tout le personnel consulte et ajoute. Modifier ou annuler : l'auteur, ou une infirmière / responsable. Un rendez-vous annulé ne change plus (409). Aucune suppression.
- Création, modification et annulation sont inscrites dans `audit_log` (`entity` : `appointment`).

## Statistiques d'un résident

`GET /residents/:id/stats?period=month|year&date=AAAA-MM-JJ` (date : un jour de la période ; défaut : aujourd'hui). **Infirmière et responsable seulement** ; chaque consultation est inscrite dans `audit_log` (`view_stats`).

Renvoie, pour la période et la précédente : totaux (notes, prioritaires, positives), notes par catégorie (toutes les catégories actives, même à zéro), évolution (`timeline` : un point par jour sur un mois, par mois sur une année, avec le détail par catégorie), moments de la journée (nuit 0-6 h, matin, après-midi, soir), suivis (ouverts, fermés, encore ouverts) et rendez-vous prévus.

- Les notes annulées ne comptent pas.
- Périodes et heures au **fuseau de la résidence** (`residences.timezone`) : une note de 23 h 30 reste sur son jour.

## Horaires du personnel

Heures locales `HH:MM` (pas de fuseau) ; une fin ≤ début signifie que le quart finit le lendemain (nuit).

| Route | Rôle |
| --- | --- |
| `GET /shift-types` | Quarts types actifs (Jour, Soir, Nuit… par défaut). `?all=true` : responsable, aussi les désactivés |
| `POST /shift-types` / `PATCH /shift-types/:id` | Responsable : `{ label, startTime, endTime, sortOrder?, isActive? }`. Changer les heures ne modifie pas les quarts déjà planifiés |
| `GET /shifts` | Tous : quarts de `[from, to]` (dates `AAAA-MM-JJ`, 62 jours au plus), `?userId=` pour un employé. Chaque quart indique `overnight` et `adjusted` (heures différentes du quart type) |
| `POST /shifts` | Responsable : `{ userId, workDate, shiftTypeId, startTime?, endTime?, notes? }` (sans heures : celles du quart type). Même quart, même jour, même employé : 409 |
| `PATCH /shifts/:id` | Responsable : quart type (et ses heures), heures ajustées, note |
| `POST /shifts/:id/cancel` | Responsable : retirer de l'horaire (204, rien n'est supprimé) |
| `POST /shifts/copy-week` | Responsable : `{ fromWeek, toWeek }` (lundis) → `{ created, skipped }` ; les quarts déjà présents sont gardés |

Toutes les écritures sont inscrites dans `audit_log` (`entity` : `shift_type`, `shift`).

## Résidents

| Route | Rôle |
| --- | --- |
| `GET /residents` | Actifs par défaut (`status` : `actif`, `parti`, `all`), tri français par nom ; `q` cherche dans le nom (sans accents) ou la chambre |
| `GET /residents/:id` | Fiche (consultation auditée). `restrictedNotes` seulement pour une infirmière ou une responsable |
| `POST /residents` | Infirmière, responsable : `{ firstName, lastName, room?, birthDate?, emergencyContact?, specialInstructions?, restrictedNotes?, admittedAt? }` (dates `AAAA-MM-JJ`) |
| `PATCH /residents/:id` | Infirmière, responsable. Départ : `{ status: "parti", leftAt }` (ses suivis encore ouverts sont fermés, note de clôture « Départ du résident. ») ; retour : `{ status: "actif" }` |

Aucune suppression de résident.

## Administration (responsable)

| Route | Rôle |
| --- | --- |
| `GET /note-categories?all=true` | Toutes les catégories, désactivées comprises (`sortOrder`, `isActive`) |
| `POST /note-categories` | `{ label, sortOrder? }` (à la fin par défaut) ; nom en double : 409 `duplicate_label` |
| `PATCH /note-categories/:id` | `{ label?, sortOrder?, isActive? }`. Jamais supprimées ; une catégorie désactivée n'est plus proposée pour une nouvelle note |
| `GET /audit` | Journal d'audit de ma résidence, plus récent d'abord. Filtres : `from`, `to`, `userId`, `action`, `entity`, `entityId` ; pagination `limit` (50, max 200) et `cursor` (= `nextCursor`) |
| `GET /residents/:id/export` | Dossier complet en JSON, en pièce jointe (`Content-Disposition`) : fiche avec champs réservés, toutes les notes (annulées comprises) et leurs corrections, suivis, historique des consultations et modifications. Pour une demande d'accès (Loi 25). L'export est audité (`export`) |

Qui a consulté un dossier : `GET /audit?entity=resident&entityId=<id>&action=view`.

## Messagerie interne

Quatre sortes de conversations : **privée** (deux employés, une seule par paire), **groupe** (titre, on y ajoute des collègues, on le quitte), **équipe** (tous les employés actifs) et **annonces** (seules l'infirmière et la responsable publient ; chacun confirme sa lecture). Texte seulement, 4 000 caractères au plus. Quasi en direct : l'interface relit la liste toutes les 15 s et le fil ouvert toutes les 5 s.

| Route | Rôle |
| --- | --- |
| `GET /conversations` | Mes conversations, la plus récente d'abord : titre, membres, dernier message, `unreadCount`, `pendingAcks` (annonces à confirmer), `canPost` |
| `GET /messaging/summary` | `{ unread, announcements }` : total des non-lus et annonces que je n'ai pas confirmées (navigation, relève) |
| `POST /conversations` | `{ kind: "direct", userId }` (retrouve la conversation existante : 200) ou `{ kind: "group", title, memberIds }` |
| `GET /conversations/:id` | Une conversation (404 si je n'en suis pas membre) |
| `PATCH /conversations/:id` | Groupe : `{ title }` |
| `POST /conversations/:id/members` | Groupe : `{ userIds }` (un ancien membre peut revenir) |
| `POST /conversations/:id/leave` | Quitter un groupe |
| `GET /conversations/:id/messages` | Les plus récents (`limit`, 50), du plus ancien au plus récent ; `before` = `nextCursor` pour remonter le fil |
| `POST /conversations/:id/messages` | `{ body }`. Annonces : infirmière et responsable seulement (403). Écrire marque la conversation lue |
| `POST /conversations/:id/read` | Lue jusqu'à maintenant |
| `PATCH /messages/:id` | L'auteur, pendant 15 min : `{ body }` ; l'ancien texte est conservé (`message_versions`) |
| `POST /messages/:id/retract` | L'auteur, pendant 15 min : le message n'est plus montré (« Message retiré »), mais il est conservé |
| `POST /messages/:id/ack` | Annonce : confirmer sa lecture (idempotent) |
| `GET /messages/:id/acks` | Infirmière, responsable : qui a confirmé, qui manque (employés actifs) |
| `GET /admin/conversations` | Responsable : conversations privées et de groupe, **sans leur contenu** (membres, nombre de messages) |
| `POST /admin/conversations/:id/consult` | Responsable : `{ reason }` (10 caractères minimum) → tous les messages, retirés et versions corrigées compris. Inscrit au journal d'audit (`consult`, avec le motif) |

- Rien n'est supprimé (`app_user` n'a pas de DELETE). `app_readonly` n'a **aucun** accès à la messagerie (échanges privés).
- Non-lus : à partir de « lu jusqu'à » (`conversation_reads`), sinon de l'arrivée dans le groupe, sinon de la création du compte. Une annonce publiée avant l'arrivée d'un employé ne lui est pas demandée.
- Journal d'audit : création de conversation, ajout de membres, départ d'un groupe, correction et retrait d'un message, consultation. Les messages eux-mêmes ne sont pas recopiés dans le journal.
- Isolation : une conversation d'une autre résidence répond 404 ; les canaux Équipe et Annonces d'une nouvelle résidence sont créés au premier usage.

## Administration de la plateforme

Rôle `admin` (compte sans résidence). L'administrateur gère **les résidences et leurs responsables**, jamais leur contenu : il ne voit que des chiffres (employés, résidents, notes des 30 derniers jours, dernière connexion, comptes bloqués). Il ne choisit jamais un mot de passe : invitation ou lien de réinitialisation par courriel. Rien n'est supprimé.

| Route | Rôle |
| --- | --- |
| `GET /platform/residences` | Résidences et indicateurs chiffrés (aucun nom de résident, aucune note) |
| `POST /platform/residences` | `{ name, type, timezone, responsable: { email, firstName, lastName } }` → résidence créée avec les catégories, quarts et canaux de messagerie habituels ; la responsable reçoit son invitation. Si le courriel ne part pas, rien n'est créé (502) |
| `GET /platform/residences/:id` | Détail : responsables, employés actifs (noms et rôles, pour en nommer un responsable), accès d'assistance |
| `PATCH /platform/residences/:id` | `{ name?, type?, timezone?, isActive?, reason? }`. Suspendre (`isActive: false`) ferme toutes les sessions et retire les accès d'assistance ; les données restent |
| `POST /platform/residences/:id/responsables` | `{ email, firstName, lastName }` (invitation) ou `{ userId }` (nommer un employé de la résidence) |
| `PATCH /platform/users/:id` | Responsable ou admin : `{ isActive }`. Jamais la dernière responsable active d'une résidence (409 `last_responsable`), ni le dernier admin, ni soi-même |
| `POST /platform/users/:id/invite` · `/reset-password` | Responsable ou admin : renvoyer l'invitation · envoyer un lien de réinitialisation (1 h) |
| `POST /platform/users/:id/unlock` · `/revoke-sessions` | Tout compte : débloquer après trop d'essais · fermer toutes ses sessions |
| `GET /platform/admins` · `POST /platform/admins` | Administrateurs ; inviter `{ email, firstName, lastName }` |
| `GET /platform/security` | Comptes bloqués, connexions refusées (24 h) par résidence, événements à surveiller (7 jours) |
| `GET /platform/audit` | Journal de la plateforme : actions des admins et événements sans résidence (`residenceId`, `action`, curseur). L'activité d'une résidence reste dans son journal |

Chaque action d'un admin sur une résidence figure **aussi** au journal de cette résidence (la responsable la voit).

### Accès d'assistance

Seule la responsable peut ouvrir la résidence à l'administrateur, pour régler un problème :

| Route | Rôle |
| --- | --- |
| `GET /assistance` | Responsable : accès accordés (en cours et passés) et nombre de pages consultées |
| `POST /assistance` | Responsable : `{ hours: 1 \| 4 \| 24 \| 72, reason? }` ; un seul accès ouvert à la fois (409 `assistance_active`) |
| `POST /assistance/:id/revoke` | Responsable : retirer l'accès, effet immédiat |
| `GET /platform/assistance` | Admin : accès ouverts |
| `POST /platform/assistance/:id/start` | Admin : jeton de consultation `{ accessToken, expiresAt, residence }`, valable jusqu'à la fin de l'accès |
| `POST /platform/assistance/:id/end` | Admin : terminer l'accès |

Avec ce jeton (`asst` dans le JWT), l'admin voit la résidence comme sa responsable, avec ces limites, revérifiées à **chaque** requête (`auth.ts`) :

- lecture seule : toute requête autre que GET est refusée dès sa réception (403 `assistance_read_only`) ;
- jamais la messagerie ni l'export d'un dossier (403 `assistance_forbidden`) ;
- accès retiré ou expiré, résidence suspendue, admin désactivé : 401 `assistance_ended` tout de suite ;
- chaque page consultée est inscrite au journal de la résidence (`assistance_view`, une ligne par page et par tranche de 5 minutes), au nom de l'admin.

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
| `POST /auth/password/reset` | `{ token, password }` (12 caractères minimum, pas le courriel) → 204 ; toutes les sessions de l'employé sont fermées |

- Liens à usage unique : un nouveau lien annule les précédents ; seul le SHA-256 est stocké (`account_tokens`).
- Le lien est `APP_URL/mot-de-passe#<jeton>` : le jeton est dans le fragment, jamais envoyé à un serveur ni noté dans un journal.
- Un compte invité n'a pas de mot de passe (`password_hash` NULL) : connexion refusée avec le message habituel.
- Audit : `create`, `invite`, `account_activated`, `password_reset_requested`, `password_reset`, `deactivate`, `reactivate`, `update`.
- Courriels : `RESEND_API_KEY` ou `BREVO_API_KEY` (API HTTPS), sinon `SMTP_URL` ; `MAIL_FROM`, `APP_URL` (voir `.env.example`). En développement, Mailpit (http://localhost:8025) reçoit tout, rien ne part pour vrai. Les tests gardent les courriels en mémoire.

## Protéger une route

```ts
import { authenticate, requireRole } from '../auth.js';

app.get('/notes', { preHandler: authenticate }, async (request) => {
  // request.user = { sub, rid, role } ; toujours filtrer par request.user.rid
});
app.post('/residents', { preHandler: requireRole('infirmiere', 'responsable') }, handler);
```
