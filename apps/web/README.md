# Interface web

React 19 + TypeScript + Vite, [TanStack Query](https://tanstack.com/query) pour les données, React Router, Tailwind CSS. Écrans pensés aussi pour tablette et téléphone (barre de navigation en bas), thème **clair par défaut** (même sur un téléphone réglé en mode sombre) ; thème sombre ou « comme l’appareil » au choix dans « Mon profil › Apparence », gardé sur l’appareil (`src/lib/theme.ts`, attribut `data-theme` de `<html>`, posé dans `index.html` avant le premier affichage).

## Démarrage

Prérequis : la base (`database/`) et l'API (`apps/api`, `npm run dev`, port 3000) démarrées.

```bash
cd apps/web
npm install
npm run dev        # http://localhost:5173
```

Comptes fictifs : `responsable@exemple.test`, `infirmiere@exemple.test`, `prepose1@exemple.test`…, `admin@exemple.test` (plateforme) mot de passe `Residence2026!` (après `npm run seed:passwords` dans `apps/api`).

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
| `/agenda` | Agenda de la semaine, jour par jour (`?semaine=AAAA-MM-JJ`) : rendez-vous des résidents et de la résidence, filtres résident / type / annulés, ajout, modification, annulation avec motif. Les rendez-vous des prochaines 24 h apparaissent aussi dans la relève, ceux d'un résident sur sa fiche |
| `/residents`, `/residents/:id` | Résidents et fiche (consignes, suivis ouverts, notes récentes) ; ajout, modification et départ pour infirmière / responsable |
| `/residents/:id` (bouton « Exporter le dossier ») | Responsable : export complet du dossier en JSON (demande d'accès, Loi 25) |
| `/administration/equipe` | Responsable seulement : inviter un employé, renvoyer l'invitation, changer le rôle, désactiver / réactiver (`/equipe` y redirige) |
| `/residents/:id/statistiques` | Infirmière, responsable : statistiques du résident par mois ou par année (`?periode=mois|annee&date=`) : chiffres clés comparés à la période précédente, « À surveiller » (hausses nettes, moment dominant), notes dans le temps (filtrables par catégorie, info-bulle au survol), par catégorie, par moment de la journée, données en tableau |
| `/horaires` | Horaires par semaine (`?semaine=`) ou par mois (`?periode=mois&mois=AAAA-MM`), `?vue=moi\|equipe`. Semaine : « Mon horaire » (jours, congés, total d'heures) ou grille de l'équipe avec la couverture par quart ; responsable : ajouter, ajuster les heures, retirer, copier la semaine précédente. Mois : calendrier (mon quart et ses heures chaque jour, total du mois ; ou qui travaille sur chaque quart, un clic ouvre la semaine) |
| `/administration/categories` | Responsable : ajouter, renommer, réordonner, désactiver / réactiver les catégories de notes |
| `/administration/quarts` | Responsable : quarts types (nom, heures), désactiver / réactiver |
| `/administration/audit` | Responsable : journal d'audit, filtres par type d'élément et par employé |
| `/mot-de-passe-oublie` | Public : demander un lien de réinitialisation par courriel |
| `/mot-de-passe#<jeton>` | Public : choisir son mot de passe (lien d'invitation ou de réinitialisation) |

**Relève et lectures** : chaque consigne prioritaire se confirme avec « J'ai lu cette consigne » ; « J'ai pris connaissance de la relève » reste bloqué tant qu'il en reste une, puis marque lues les notes ordinaires. Une consigne corrigée affiche « Corrigée — à relire » ; une note ordinaire corrigée après ma lecture, « Modifiée depuis votre lecture ». Sur une consigne prioritaire, « Pas encore lue par » liste les employés qui ne l'ont pas confirmée.

**Suivis** : « Je m'en occupe » m'assigne le suivi ; les suivis terminés apparaissent dans le dossier du résident.

**Téléphone** : 5 onglets en bas (Relève, Journal, Suivis, Messages, Résidents) avec des icônes dessinées (`components/NavIcon.tsx`, identiques sur iPhone et Android ; onglet actif dans une pastille colorée), et un menu « Plus » qui monte du bas (Agenda, Horaires, Admin, Mon profil). La barre tient compte de la barre d’accueil de l’iPhone : sa hauteur est `--nav-h` (`index.css`, avec `viewport-fit=cover`), sur laquelle se calent la barre « J’ai pris connaissance de la relève » (fixée juste au-dessus) et la messagerie.

**Messagerie** (`/messages`, `/messages/:id`) : liste à gauche et fil à droite sur ordinateur ; liste puis fil en plein écran sur téléphone. Entrée envoie, Maj+Entrée va à la ligne. Mes messages se modifient ou se retirent pendant 15 minutes. Annonces : « J'ai lu cette annonce » (aussi en tête de la relève) ; l'autrice voit « Lue par N — voir qui manque ». Groupe : renommer, ajouter des collègues, quitter. Pastille de non-lus sur l'onglet Messages. Responsable : Administration › Messagerie pour consulter une conversation avec un motif (tracé).

**Plateforme** (`/plateforme`, rôle admin) : résidences avec indicateurs chiffrés, création d'une résidence (et invitation de sa responsable), détail d'une résidence (modifier, suspendre, responsables : inviter, nommer un employé, renvoyer l'invitation, lien de mot de passe, débloquer, fermer les sessions, désactiver), Sécurité, Journal, Administrateurs. Un admin qui ouvre une page de résidence est renvoyé ici.

**Accès d'assistance** : la responsable l'accorde dans Administration › Assistance (durée, motif ; retrait à tout moment ; historique avec le nombre de pages consultées). L'admin clique « Consulter (lecture seule) » : il voit la résidence comme la responsable, sous un bandeau orange (« Revenir à la plateforme », « Terminer l'accès »), sans la messagerie ; toute tentative de modification est refusée et signalée dans le bandeau. Le jeton d'assistance reste en mémoire : recharger la page ramène à la plateforme.

**Double authentification** (responsables, admins) : après le mot de passe, code à 6 chiffres de l'application d'authentification (ou code de secours). Première fois : code QR (ou clé à saisir), confirmation, puis 10 codes de secours à noter (copier, télécharger, imprimer) avant d'entrer.

**Dictée des notes** : bouton rond avec un micro sous « Ce qui s'est passé » et « Intervention » (icône seule ; rouge avec un halo pendant l'écoute, clic pour arrêter ; petite flèche tant que le français n'est pas installé). La voix est transcrite **sur l'appareil seulement** (Web Speech API avec `processLocally`, `src/lib/dictation.ts`) : une note parle de la santé d'un résident (Loi 25), elle ne doit pas passer par les serveurs de Google ou d'Apple. La première fois, le bouton télécharge le français sur l'appareil (une seule fois). Navigateur sans reconnaissance locale (Firefox, Safari, Chrome ancien) : pas de bouton, on tape la note. Le texte dicté s'ajoute à la fin (majuscule en début de phrase) et se relit avant d'enregistrer ; la ponctuation se tape à la main.

**Avatar** (`components/Avatar.tsx`, `lib/avatar.ts`) : en haut à droite, à gauche du nom (seul sur téléphone) ; un clic ouvre « Mon profil ». Chacun choisit son personnage dans une galerie (24 avatars illustrés, styles « Portraits » et « Croquis ») ou garde ses initiales, et une couleur de fond (sinon tirée de l'id : toujours la même pour une personne). Aussi dans l'équipe (Administration › Équipe, avec le téléphone). Les illustrations sont dessinées dans le navigateur par [DiceBear](https://www.dicebear.com) (styles Lorelei et Notionists : dessins sous licence CC0, code MIT) : aucune image n'est téléversée ni stockée, la base garde seulement « style:nom ». Les dessins (environ 500 Ko) sont dans un fichier à part (`lib/avatar-art.ts`), chargé seulement quand un avatar illustré s'affiche ; en attendant, les initiales.

**Mon profil** (`/compte`, ou le rond en haut ; « Plus » sur téléphone) : coordonnées (prénom, nom, téléphone, couleur du rond, aperçu en direct), mot de passe (actuel + nouveau, « Déconnecter mes autres appareils »), notifications de cet appareil (activer, essai, choix des avis) et double authentification (codes de secours restants, nouvelle série). Une invitation à activer les notifications apparaît une fois dans la relève. Pas de notifications sur un appareil partagé ; sur iPhone/iPad, seulement une fois l'application ajoutée à l'écran d'accueil. Une déconnexion volontaire désabonne l'appareil. Le service worker (`public/sw.js`) affiche les notifications et ouvre la bonne page au toucher ; il est aussi enregistré en développement.

L'interface masque les actions non permises (ex. « Corriger » après 24 h pour un préposé), mais c'est l'API qui fait foi.

## Français et anglais (i18n)

[i18next](https://www.i18next.com) + react-i18next. **Français par défaut** ; l'anglais se choisit sur la page de connexion (et les pages du mot de passe) ou dans « Mon profil › Apparence › Langue » (`components/LanguageSwitch.tsx`).

- **Où sont les textes** : `src/i18n/fr/<partie>.ts` (référence) et `src/i18n/en/<partie>.ts` (`common`, `auth`, `shell`, `journal`, `residents`, `agenda`, `schedule`, `messages`, `admin`, `account`, `platform`), réunis dans `src/i18n/fr/index.ts` et `en/index.ts`.
- **Garde-fou** : chaque fichier anglais est déclaré `satisfies Translation<typeof fr>` (`src/i18n/types.ts`) : une clé manquante ou en trop fait échouer `npm run build`. Les clés utilisées dans les composants sont vérifiées aussi (`t('journal.note.title')` qui n'existe pas : erreur de compilation).
- **Ajouter un texte** : la clé dans les deux langues, puis `const { t } = useTranslation();` et `t('partie.cle', { valeur })`. Pluriels : clés `_one` / `_other` et `{ count }`. Texte avec balises : `<Trans i18nKey="…" components={{ strong: <strong /> }} />`.
- **Dates et heures** : `lib/format.ts` suit la langue (`fr-CA` ou `en-CA`) ; durées et heures des quarts : `lib/schedule.ts`.
- **Erreurs de l'API** : messages français du serveur ; en anglais, l'interface affiche la traduction de leur code (`src/i18n/api-errors.ts`, voir `api/client.ts`). Nouvelle erreur côté API : ajouter son code (le test `apps/api/test/i18n.test.ts` le vérifie).
- **La langue** est gardée sur l'appareil (`localStorage` « lang ») et dans le compte (`users.locale`, `PATCH /auth/me`) : à la connexion, une langue choisie sur l'appareil est enregistrée dans le compte, sinon l'appareil prend celle du compte (`auth/AuthProvider.tsx`). Changer de langue redessine l'application (adresse, session et données gardées).
- **Hors React** : `public/offline.html` lit la même préférence ; la dictée des notes écoute la langue de l'interface (`fr-CA` ou `en-CA`).
- Les données saisies (notes, catégories, quarts types, noms des canaux créés par le serveur) ne sont pas traduites, sauf les canaux « Toute l'équipe » et « Annonces » (`lib/messaging.ts`).

## Session

- Connexion en **mode cookie** : le jeton de rafraîchissement est dans un cookie `httpOnly` (illisible par le JavaScript de la page), le jeton d'accès reste **en mémoire** seulement.
- Recharger la page restaure la session par ce cookie. Un jeton d'accès expiré est renouvelé automatiquement, une seule fois même avec plusieurs onglets ouverts (Web Locks).
- **Appareil partagé** (case à la connexion) : la session se ferme à la fermeture du navigateur et après **15 minutes sans activité**, avec un avertissement une minute avant (« Toujours là ? »). La dernière activité est partagée entre les onglets. Sur un appareil personnel, la session dure 12 h.
- Le site et l'API doivent être servis **sur la même origine** (en développement, le proxy de Vite ; en production, un reverse proxy qui envoie `/api/*` à l'API).

## Application installable (PWA) et hors connexion

- `public/manifest.webmanifest` et `public/icons/` : installable sur téléphone et tablette (« Ajouter à l'écran d'accueil »), sans magasin d'applications.
- `public/sw.js` (enregistré en production seulement) : met en cache **uniquement les fichiers de l'interface** (code, styles, icônes). **Aucune réponse de l'API n'est mise en cache** : aucune donnée de résident ne reste sur l'appareil (Loi 25).
- Sans réseau : bandeau « Hors connexion » dans l'application, et page `offline.html` si on ouvre une page. Tout se recharge au retour du réseau.
- Après une modification de `sw.js`, changer `VERSION` dans le fichier : l'ancien cache est supprimé.

## Logo

- Source : `brand/logo-original.png` (grand format, hors de `public/` : il n'est pas servi aux navigateurs).
- `npm run icons` (script `scripts/build-icons.mjs`) génère à partir de cette source :
  - `public/logo.png` et `public/logo-dark.png` : interface, **fond transparent** (le blanc est converti en transparence, sans liseré). Version sombre : le bleu marine est éclairci pour rester lisible ;
  - `public/icons/favicon-64.png` : onglet du navigateur, fond transparent ;
  - `public/icons/` (192, 512, maskable, Apple) : application installée, **fond blanc** opaque, car Android et iPhone découpent eux-mêmes l'icône.
- `components/Logo.tsx` affiche la bonne version selon le thème de l'appareil.
- Après un changement de logo : remplacer la source, lancer `npm run icons`, puis changer `VERSION` dans `public/sw.js`.

## Structure

```
src/
├── api/          client HTTP (session), types, hooks de données
├── auth/         fournisseur de session, rôles
├── components/   éléments partagés (ui, carte de note, formulaires, suivis, cadre)
├── lib/          dates en français, utilitaires
└── pages/        un fichier par écran
```

**Aide** (`/aide`, `/plateforme/aide` ; icône « ? » en haut, « Aide » dans « Plus » sur téléphone) : guide d'utilisation de chaque rôle (le sien d'abord ; l'infirmière lit aussi celui du préposé, la responsable ceux de l'infirmière et du préposé), et une section pour tous (installation, notifications, appareil partagé, Loi 25, langue). Textes : `i18n/fr/help.ts` et `i18n/en/help.ts`.

**Visite guidée** (`components/Tour.tsx`, étapes dans `lib/tour.ts`) : proposée une fois à la première connexion sur l'appareil, relançable depuis Aide. Chaque étape ouvre sa page et met en évidence un élément marqué `data-tour="…"` (la première cible visible : l'onglet sur ordinateur, sinon « Plus » sur téléphone) ; sans cible, la bulle s'affiche au centre. La page reste utilisable ; Échap ferme, flèches pour avancer ou reculer. Un élément renommé ou déplacé garde son attribut `data-tour`, sinon l'étape s'affiche au centre.

