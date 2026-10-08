# Journal de bord — résidences pour aînés

Application web pour les équipes de résidences (RPA, RI). Les préposés, infirmières et responsables y consignent ce qui se passe pendant leur quart et se passent le relais entre les quarts.

- **Relève** : en début de quart, ce qui s'est passé depuis ma dernière relève (consignes prioritaires d'abord) et les suivis à faire.
- **Journal de bord** : notes par résident, recherche, corrections avec historique, annulation avec motif. Rien n'est jamais supprimé.
- **Suivis** : actions à faire issues d'une note, assignées à quelqu'un ou à toute l'équipe.
- **Résidents** : fiches, consignes particulières, notes réservées aux infirmières et responsables.
- **Équipe** : la responsable invite les employés par courriel ; chacun choisit son mot de passe.

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

Démarre la base principale, le serveur de reprise et Mailpit (boîte de réception de test). Au premier démarrage, le schéma et des **données fictives** sont créés (1 résidence, 15 résidents, environ 180 notes).

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
| `responsable@exemple.test` | Responsable | Gérer l'équipe (inviter, désactiver), tout ce que fait l'infirmière |
| `infirmiere@exemple.test` | Infirmière | Corriger ou annuler toute note, gérer les résidents, lire les notes réservées |
| `prepose1@exemple.test` … `prepose4@exemple.test` | Préposé·e | Relève, notes, suivis ; corriger sa propre note pendant 24 h |
| `admin@exemple.test` | Administrateur plateforme | Aucun accès au journal (pas de résidence), pas encore d'écran |

Les mots de passe ne sont stockés nulle part en clair, seulement sous forme hachée.

## Adresses utiles en développement

| Adresse | Quoi |
| --- | --- |
| http://localhost:5173 | Interface web |
| http://localhost:8025 | Mailpit : courriels envoyés par l'application (invitations, mot de passe oublié). Rien ne part pour vrai |
| http://127.0.0.1:3000/health | État de l'API et de la base |
| `localhost:5432` / `localhost:5433` | PostgreSQL principal / serveur de reprise (lecture seule) |

## Tests

```bash
cd apps/api
npm test                  # tests d'intégration ; Docker doit tourner
```

Les tests recréent leur propre base (`residence_test`) à chaque exécution. La base de développement n'est jamais touchée.

Pour l'interface : `npm run build` (vérification des types) et `npm run lint` dans `apps/web`.

## Pour aller plus loin

- [database/README.md](database/README.md) : sauvegardes, bascule vers le serveur de reprise, restauration à un instant précis, migrations.
- [apps/api/README.md](apps/api/README.md) : toutes les routes de l'API et les règles d'accès par rôle.
- [apps/web/README.md](apps/web/README.md) : écrans, gestion de la session, structure du code.
