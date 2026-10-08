# Interface web

React 19 + TypeScript + Vite, [TanStack Query](https://tanstack.com/query) pour les données, React Router, Tailwind CSS. Écrans pensés aussi pour tablette et téléphone (barre de navigation en bas), thème sombre automatique pour les quarts de nuit.

## Démarrage

Prérequis : la base (`database/`) et l'API (`apps/api`, `npm run dev`, port 3000) démarrées.

```bash
cd apps/web
npm install
npm run dev        # http://localhost:5173
```

Comptes fictifs : `responsable@exemple.test`, `infirmiere@exemple.test`, `prepose1@exemple.test`… mot de passe `Residence2026!` (après `npm run seed:passwords` dans `apps/api`).

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de développement ; `/api/*` est redirigé vers l'API (`API_URL`, par défaut `http://127.0.0.1:3000`) |
| `npm run build` | Vérification des types + version de production dans `dist/` |
| `npm run lint` | Oxlint |

## Écrans

| Adresse | Écran |
| --- | --- |
| `/` | **Relève** : consignes prioritaires, suivis à faire, nouvelles notes depuis ma dernière relève, « J'ai pris connaissance » |
| `/journal` | Journal : recherche (sans accents), filtres (résident, catégorie, statut, prioritaires, non lues) conservés dans l'adresse, nouvelle note |
| `/notes/:id` | Note : marquer comme lue, ajouter un suivi, corriger, annuler (avec motif), qui l'a lue, historique des corrections |
| `/suivis` | Suivis : pour moi, pour l'équipe, tous les ouverts, faits |
| `/residents`, `/residents/:id` | Résidents et fiche (consignes, suivis ouverts, notes récentes) ; ajout, modification et départ pour infirmière / responsable |

L'interface masque les actions non permises (ex. « Corriger » après 24 h pour un préposé), mais c'est l'API qui fait foi.

## Session

- Connexion en **mode cookie** : le jeton de rafraîchissement est dans un cookie `httpOnly` (illisible par le JavaScript de la page), le jeton d'accès reste **en mémoire** seulement.
- Recharger la page restaure la session par ce cookie. Un jeton d'accès expiré est renouvelé automatiquement, une seule fois même avec plusieurs onglets ouverts (Web Locks).
- Le site et l'API doivent être servis **sur la même origine** (en développement, le proxy de Vite ; en production, un reverse proxy qui envoie `/api/*` à l'API).

## Structure

```
src/
├── api/          client HTTP (session), types, hooks de données
├── auth/         fournisseur de session, rôles
├── components/   éléments partagés (ui, carte de note, formulaires, suivis, cadre)
├── lib/          dates en français, utilitaires
└── pages/        un fichier par écran
```
