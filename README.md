# Journal de bord — résidences pour aînés

Application web pour les équipes de résidences (RPA, RI). Les préposés, infirmières et responsables y consignent ce qui se passe pendant leur quart et se passent le relais entre les quarts.

- **Relève** : en début de quart, ce qui s'est passé depuis ma dernière relève (consignes prioritaires d'abord) et les suivis à faire.
- **Journal de bord** : notes par résident, recherche, corrections avec historique, annulation avec motif. Rien n'est jamais supprimé. **Dictée** des notes au micro, transcrite sur l'appareil même (la voix n'est envoyée nulle part) quand le navigateur le permet (Chrome récent).
- **Suivis** : actions à faire issues d'une note, assignées à quelqu'un ou à toute l'équipe.
- **Agenda** : rendez-vous des résidents (médecin, transport, visite…) et de la résidence (activités, réunions) ; ceux des prochaines 24 h apparaissent dans la relève.
- **Horaires** : la responsable place les quarts de l'équipe (Jour, Soir, Nuit…) semaine par semaine ; chacun voit son horaire.
- **Résidents** : fiches, consignes particulières, notes réservées aux infirmières et responsables ; statistiques par mois ou par année (tendances par catégorie, moments de la journée) pour l'infirmière et la responsable.
- **Équipe** : la responsable invite les employés par courriel ; chacun choisit son mot de passe.
- **Français / English** : l'interface entière, les courriels et les notifications existent dans les deux langues. Choix sur la page de connexion ou dans « Mon profil », gardé dans le compte. Français par défaut.
- **Mon profil** : chacun choisit son avatar (galerie de personnages illustrés, ou ses initiales ; affiché en haut à droite), modifie son nom et son téléphone, et change son mot de passe (avec l'actuel ; option « déconnecter mes autres appareils » ; avis par courriel).
- **Messagerie** : messages privés, groupes, fil de toute l'équipe et annonces de la direction avec confirmation de lecture. Un message se corrige ou se retire pendant 15 minutes, rien n'est supprimé.
- **Administration** : catégories de notes, journal d'audit (qui a consulté quoi), export complet du dossier d'un résident (Loi 25).
- **Plateforme** (plusieurs résidences) : l'administrateur crée les résidences et leurs responsables, suspend une résidence, débloque un compte, surveille la sécurité ; il ne voit que des chiffres. La responsable peut lui accorder un **accès d'assistance** limité dans le temps, en lecture seule et tracé.

Sur téléphone et tablette, l'application s'installe comme une application (PWA) et envoie des **notifications** (consignes prioritaires pendant le quart, messages, annonces, suivis), sans jamais afficher de nom de résident ni de contenu. Les responsables et l'administration se connectent avec la **double authentification** (application d'authentification + codes de secours). Sur un appareil partagé, la session se ferme après 15 minutes sans activité. Aucune donnée de résident n'est gardée hors connexion.

Chaque résidence ne voit que ses propres données, et chaque action sensible est inscrite dans un journal d'audit.

## Architecture

| Dossier | Contenu | Technologies |
| --- | --- | --- |
| [`database/`](database/README.md) | Base de données, sauvegardes, serveur de reprise | PostgreSQL 16, pgBackRest, Docker Compose |
| [`apps/api/`](apps/api/README.md) | API | Node.js, TypeScript, Fastify, Kysely |
| [`apps/web/`](apps/web/README.md) | Interface web | React, TypeScript, Vite, Tailwind CSS |

Le schéma de la base est défini par les migrations SQL de `database/migrations/`. L'API s'y connecte avec un compte limité : il ne peut rien supprimer.

## Prérequis

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js](https://nodejs.org/) 22 ou plus récent
- **Sous Windows** : [Git for Windows](https://git-scm.com/download/win), pour Git Bash (les scripts de `database/scripts/` sont en Bash)

## Démarrage

Trois étapes, dans cet ordre. La première prend quelques minutes la première fois.

### 1. Base de données

```bash
cd database
cp .env.example .env      # puis remplacer TOUS les mots de passe (sans espaces)
docker compose up -d --build
```

Démarre la base principale, le serveur de reprise et Mailpit (boîte de réception de test). Au premier démarrage, le schéma et des **données fictives** sont créés (1 résidence, 15 résidents, environ 180 notes sur le dernier mois plus un an d'historique pour les statistiques, deux semaines d'horaire).

> **Sous Windows**
> - Si Git a converti les scripts en fins de ligne Windows, les conteneurs ne démarrent pas (`bash\r: No such file or directory`). Voir « Prérequis » dans [database/README.md](database/README.md).
> - Le port 5432 doit être libre : arrêter un PostgreSQL installé directement sur Windows (`Stop-Service postgresql-x64-<version>`, PowerShell en administrateur).

### 2. API

```bash
cd apps/api
cp .env.example .env      # DATABASE_URL : mot de passe APP_DB_PASSWORD de database/.env
                          # JWT_SECRET : générer avec la commande indiquée dans le fichier
npm install
npm run seed:passwords    # donne le mot de passe Residence2026! aux comptes fictifs
npm run dev               # http://127.0.0.1:3000 — laisser ce terminal ouvert
```

### 3. Interface web

Dans un **deuxième terminal** :

```bash
cd apps/web
npm install
npm run dev               # http://localhost:5173 — laisser ce terminal ouvert
```

Ouvrir **http://localhost:5173** et se connecter avec un compte de démonstration.

## Comptes de démonstration

Mot de passe pour tous : **`Residence2026!`**

| Courriel | Rôle | Peut en plus |
| --- | --- | --- |
| `responsable@exemple.test` | Responsable | Administration : équipe, catégories, journal d'audit, export d'un dossier (Loi 25) ; tout ce que fait l'infirmière |
| `infirmiere@exemple.test` | Infirmière | Consignes prioritaires, corriger ou annuler toute note, gérer les résidents, lire les notes réservées |
| `prepose1@exemple.test` … `prepose4@exemple.test` | Préposé·e | Relève, notes, suivis ; corriger sa propre note pendant 24 h |
| `admin@exemple.test` | Administrateur plateforme | Tableau de bord de la plateforme (`/plateforme`) : résidences, responsables, sécurité, journal ; une résidence seulement avec un accès d'assistance |
| `responsable2@exemple.test`, `prepose5@exemple.test` | Responsable, préposé | Deuxième résidence fictive (Manoir du Fleuve) |

Les mots de passe ne sont stockés nulle part en clair, seulement sous forme hachée.

## Adresses utiles en développement

| Adresse | Quoi |
| --- | --- |
| http://localhost:5173 | Interface web |
| http://localhost:8025 | Mailpit : courriels envoyés par l'application (invitations, mot de passe oublié). Rien ne part pour vrai |
| http://127.0.0.1:3000/health | État de l'API et de la base |
| `localhost:5432` / `localhost:5433` | PostgreSQL principal / serveur de reprise (lecture seule) |

## Fonctionnalités activables par résidence

L'administration de la plateforme choisit, pour chaque résidence, ce que chaque rôle voit et peut faire (Plateforme › une résidence › **Fonctionnalités**). Trois niveaux par module : **Masqué**, **Consultation** (lire sans écrire), **Complet**. Formules prêtes : Complète (par défaut), Essentielle, Journal infirmier ; exceptions possibles pour une personne précise.

- **Onze modules** : Relève, Journal, Consignes prioritaires, Suivis, Messagerie, Annonces, Agenda, Horaires, Résidents, Statistiques, Dictée. Toujours actifs : journal d'audit, export d'un dossier (Loi 25), équipe, Mon profil, Aide.
- **Un réglage ne donne jamais plus que le rôle**, et les dépendances sont appliquées (sans Journal, pas de Relève ni de Dictée).
- **L'API décide** : chaque route est rattachée à un module (`apps/api/src/lib/feature-routes.ts`) ; une route sans règle empêche l'API de démarrer. L'interface cache ce que l'API refuserait (navigation, boutons, sections, visite guidée, aide, notifications).
- **Rien n'est effacé** : réactiver un module rend ses données. Chaque changement est tracé et la responsable est prévenue par courriel ; elle voit les réglages dans Admin › Fonctionnalités (lecture seule).
- **Délai** : un changement s'applique en moins d'une minute, sans reconnexion.

Ajouter un module : le déclarer dans `apps/api/src/lib/features.ts` (niveaux, plafond par rôle, dépendances), rattacher ses routes dans `feature-routes.ts`, puis ajouter ses libellés (`platform.features` en français et en anglais) et sa règle d'affichage (`apps/web/src/lib/access.ts`). Détails : [apps/api/README.md](apps/api/README.md#fonctionnalités-activables).

## Tests

```bash
cd apps/api
npm test                  # tests d'intégration ; Docker doit tourner
```

Les tests recréent leur propre base (`residence_test`) à chaque exécution. La base de développement n'est jamais touchée.

Pour l'interface : `npm run build` (vérification des types) et `npm run lint` dans `apps/web`.

## Règle des deux langues (pour toute nouvelle fonctionnalité)

Tout texte visible existe en **français et en anglais**. Le français reste la langue par défaut (Charte de la langue française).

- **Interface** : aucun texte en dur dans un composant. Ajouter la clé dans `apps/web/src/i18n/fr/<partie>.ts` **et** `apps/web/src/i18n/en/<partie>.ts`, puis `t('partie.cle')` (`useTranslation`). Une clé absente de l'anglais (ou mal écrite dans un composant) **fait échouer la compilation** (`npm run build`).
- **Erreurs de l'API** : le serveur écrit ses messages en français ; chaque nouveau code d'erreur reçoit sa traduction dans `apps/web/src/i18n/api-errors.ts`. Le test `apps/api/test/i18n.test.ts` échoue sinon.
- **Courriels et notifications** : textes dans `apps/api/src/lib/locale.ts` (`MAIL_TEXT`, `PUSH_TEXT`), envoyés dans la langue du destinataire (`users.locale`). Le type `Localized<T>` refuse un texte sans sa version anglaise.
- **Données** : ce que l'équipe saisit (notes, noms de catégories, quarts) n'est pas traduit.

## Pour aller plus loin

- [database/README.md](database/README.md) : sauvegardes, bascule vers le serveur de reprise, restauration à un instant précis, migrations.
- [apps/api/README.md](apps/api/README.md) : toutes les routes de l'API et les règles d'accès par rôle.
- [apps/web/README.md](apps/web/README.md) : écrans, gestion de la session, application installable, structure du code.
- [Déploiement de test (Railway + Vercel)](apps/api/README.md#déploiement-de-test--railway-api--base-et-vercel-interface) et vérification automatique (GitHub Actions).
