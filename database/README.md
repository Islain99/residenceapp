# Base de données — principal + reprise

Deux serveurs **PostgreSQL 16** identiques et un dépôt de sauvegardes **pgBackRest** :

| Service | Rôle | Port local |
| --- | --- | --- |
| `pg-primary` | SGBD principal : l'API lit et écrit ici | 5432 |
| `pg-replica` | SGBD de reprise : copie en continu (streaming replication), lecture seule, promu principal en cas de panne | 5433 |
| `pg-restore` | Copie restaurée à un instant précis, créée à la demande pour récupérer des données | 5434 |
| dépôt pgBackRest | Sauvegardes chiffrées + archives WAL (restauration à la seconde près) | — |

```
         API (Node/Express)
              │  DATABASE_URL
              ▼
   ┌──────────────────────┐  réplication (WAL)  ┌──────────────────────┐
   │ pg-primary (5432)    │ ──────────────────▶ │ pg-replica (5433)    │
   │ lecture + écriture   │                     │ lecture seule        │
   └──────────┬───────────┘                     └──────────┬───────────┘
              │ archive-push (WAL toutes les ≤ 5 min)      │ archive-get (rattrapage)
              ▼                                            ▼
        ┌─────────────────────────────────────────────────────────┐
        │ Dépôt pgBackRest — sauvegardes chiffrées AES-256 + WAL   │
        └─────────────────────────────────────────────────────────┘
```

**Le réplica ne remplace pas les sauvegardes.** Une suppression par erreur est copiée sur le réplica en une seconde. Le réplica protège contre la panne d'un serveur ; les sauvegardes + WAL protègent contre l'erreur humaine et la corruption.

## Objectifs de reprise (prototype)

| | Panne du principal (bascule) | Erreur humaine / corruption (restauration) |
| --- | --- | --- |
| Perte de données max. (RPO) | Quelques secondes (réplication asynchrone) | ≤ 5 min (`archive_timeout = 300`) |
| Remise en service (RTO) | < 15 min, bascule manuelle | < 1 h |

## Démarrage

Prérequis : Docker Desktop (ou Docker Engine + Compose v2).

```bash
cd database
cp .env.example .env          # puis remplacer TOUS les mots de passe
docker compose up -d --build  # principal, puis réplica (copie initiale automatique)
scripts/backup.sh full        # première sauvegarde complète
scripts/status.sh             # vérifier : 1 principal, 1 réplica "streaming", sauvegarde OK
```

Au premier démarrage du principal : création du dépôt de sauvegarde, des rôles, du slot de réplication, du schéma (`migrations/`), puis des données fictives si `SEED=true`.

Sous Windows, lancer les scripts dans Git Bash ou WSL.

## Comptes de base de données

| Rôle | Usage | Droits |
| --- | --- | --- |
| `postgres` | Administration seulement | Superutilisateur |
| `app_migrator` | Migrations | Propriétaire du schéma |
| `app_user` | **API** (`DATABASE_URL`) | SELECT / INSERT / UPDATE. **Aucun DELETE** (on annule, on ne supprime pas). `audit_log` : INSERT + SELECT seulement |
| `app_readonly` | Rapports, support, lecture sur le réplica | SELECT, sauf `refresh_tokens` |
| `replicator` | Réplication | Réplication uniquement |

Garanties au niveau de la base (pas seulement dans l'API) :

- **Isolation entre résidences** : clés étrangères composées `(residence_id, id)`. Une note de la résidence B ne peut pas pointer vers un résident, un employé ou une catégorie de la résidence A.
- **Journal d'audit en ajout seul** : droits + trigger qui bloque UPDATE, DELETE et TRUNCATE.
- **Recherche plein texte française, insensible aux accents** (`désorientée` = `desorientee`).

## Opérations courantes

| Commande | Quand |
| --- | --- |
| `scripts/status.sh` | Chaque jour, et avant toute opération |
| `scripts/backup.sh full` | 1 fois par semaine (dimanche nuit) |
| `scripts/backup.sh diff` | Chaque nuit |
| `scripts/migrate.sh` | Après l'ajout d'un fichier dans `migrations/` |
| `scripts/restore-test.sh` | **1 fois par mois** : prouve que les sauvegardes sont restaurables |

Planifier les sauvegardes avec cron (Linux) ou le Planificateur de tâches (Windows) :

```cron
0 2 * * 0    cd /chemin/database && scripts/backup.sh full
0 2 * * 1-6  cd /chemin/database && scripts/backup.sh diff
```

## Scénario 1 — Le principal tombe en panne (bascule)

```bash
scripts/status.sh              # confirmer : pg-primary injoignable, pg-replica OK
scripts/failover.sh            # arrête pg-primary, promeut pg-replica
```

Puis :
1. API : `DATABASE_URL` → port **5433**, redémarrer l'API.
2. `scripts/backup.sh full` sur le nouveau principal.
3. **Ne pas** relancer l'ancien `pg-primary` tel quel (deux principaux = données divergentes). Ne pas faire `docker compose up -d` sans nom de service tant que le retour à la normale n'est pas fait.

## Scénario 2 — Retour à la normale après une bascule

```bash
scripts/failback.sh
```

Recrée `pg-primary` comme réplica de `pg-replica`, attend qu'il soit à jour, demande d'arrêter l'API, arrête proprement `pg-replica` (tous les WAL sont transmis : aucune perte), promeut `pg-primary`, puis reconstruit `pg-replica`. Interruption : environ 1 minute. Remettre ensuite l'API sur le port 5432.

## Scénario 3 — Erreur humaine (données écrasées ou effacées)

La production n'est **pas** touchée : on restaure une copie à côté, on y récupère les données.

```bash
scripts/restore-test.sh "2026-10-14 14:19:00"   # heure de Montréal, juste AVANT l'erreur
psql -h localhost -p 5434 -U postgres residence  # consulter, exporter les lignes à récupérer
docker compose --profile restore rm -sf pg-restore
```

La copie restaurée n'archive rien (`archive_mode = off`) : elle ne peut pas polluer le dépôt de production.

## Scénario 4 — Le réplica est corrompu ou trop en retard

```bash
scripts/rebuild-replica.sh      # efface et recopie le réplica depuis le principal
```

## Vers la production

- **Deux emplacements distincts au Canada** : principal et réplica dans deux régions ou deux fournisseurs (ex. Azure Canada Central / Canada East, ou OVHcloud Beauharnois). Même image, même configuration ; seul `PRIMARY_HOST` change.
- **Dépôt de sauvegarde sur stockage objet canadien**, dans `config/pgbackrest.conf` :
  ```ini
  repo1-type=s3
  repo1-s3-endpoint=<fournisseur>
  repo1-s3-bucket=residence-backups
  repo1-s3-region=ca-central-1
  repo1-path=/residence
  ```
- **Réplication synchrone** (zéro perte à la bascule, écritures un peu plus lentes et bloquées si le réplica tombe) : `synchronous_standby_names = 'replica1'` sur le principal. À décider avec la résidence.
- **TLS** sur les connexions (`ssl = on`, certificats) avant toute donnée réelle.
- **Bascule automatique** plus tard avec Patroni, si le besoin se confirme.

## Plus tard — le serveur local de reprise

Le serveur local (à la résidence) s'ajoute **sans changer l'application** : même image, `NODE_ROLE=replica`, `PRIMARY_HOST` = adresse du principal (via VPN), et un slot dédié :

```sql
SELECT pg_create_physical_replication_slot('replica_local');
```

Il peut aussi recevoir un deuxième dépôt pgBackRest (`repo2-*`) pour avoir une copie des sauvegardes hors du nuage. À ce moment, le réplica hébergé peut être conservé (deux copies) ou retiré.

## Fichiers

```
database/
├── docker-compose.yml          # 3 services + volumes
├── .env.example                # mots de passe (copier en .env)
├── config/
│   ├── postgresql.conf         # commun aux deux serveurs
│   └── pgbackrest.conf         # dépôt chiffré, rétention 4 semaines
├── docker/
│   ├── Dockerfile              # postgres:16 + pgBackRest
│   ├── node-entrypoint.sh      # démarrage selon NODE_ROLE (primary / replica / restore)
│   └── failback.override.yml
├── init/                       # exécutés une seule fois, à la création du principal
│   ├── 05-pgbackrest-stanza.sh
│   ├── 10-roles.sh
│   ├── 20-migrate.sh
│   ├── 30-seed.sh
│   └── 90-pgbackrest-check.sh
├── migrations/0001_init.sql    # schéma V1
├── seed/seed.sql               # données fictives
└── scripts/                    # status, backup, failover, failback, restore-test, rebuild-replica, migrate
```

Avec Prisma : `prisma db pull` génère `schema.prisma` à partir de ce schéma, puis `prisma migrate resolve --applied 0001_init` le marque comme déjà appliqué.
