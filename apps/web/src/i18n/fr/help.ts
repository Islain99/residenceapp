// Aide : guides d'utilisation par rôle et visite guidée interactive.
// Dans un corps de texte, chaque ligne (\n) devient un point de liste.
export default {
  nav: 'Aide',
  title: 'Aide',
  subtitle: 'Guides d’utilisation par rôle et visite guidée de l’application.',
  startTour: 'Lancer la visite guidée',
  tourHint: 'Environ 2 minutes : la visite montre où se trouve chaque chose, écran par écran.',
  chooseRole: 'Guide pour',
  roles: {
    prepose: 'Préposé·e',
    infirmiere: 'Infirmière',
    responsable: 'Responsable',
    admin: 'Administration de la plateforme',
  },
  general: {
    title: 'Pour tout le monde',
    install: {
      title: 'Installer l’application sur un téléphone',
      body: 'iPhone et iPad : ouvrir l’adresse dans Safari, toucher Partager, puis « Sur l’écran d’accueil ».\nAndroid : ouvrir l’adresse dans Chrome, menu ⋮, puis « Installer l’application ».\nEnsuite, toujours ouvrir l’application depuis son icône.',
    },
    notifications: {
      title: 'Recevoir les notifications',
      body: 'Mon profil › Notifications › « Activer sur cet appareil », puis accepter la demande du téléphone.\nUne notification n’affiche jamais le nom d’un résident ni le texte d’un message : il faut ouvrir l’application.\nSur iPhone, seulement une fois l’application ajoutée à l’écran d’accueil.',
    },
    shared: {
      title: 'Ordinateur ou tablette partagé au poste',
      body: 'Cocher « Appareil partagé » à la connexion.\nLa session se ferme après 15 minutes sans activité, et à la fermeture du navigateur.\nToujours se déconnecter en partant.',
    },
    privacy: {
      title: 'Confidentialité (Loi 25)',
      body: 'Ne noter que ce qui est utile aux soins et à la sécurité du résident.\nChaque consultation d’un dossier est inscrite au journal d’audit.\nRien n’est effacé : une note se corrige ou s’annule avec un motif, l’historique reste.',
    },
    language: {
      title: 'Langue et apparence',
      body: 'Mon profil › Apparence : français ou anglais, thème clair ou sombre.',
    },
  },
  guides: {
    prepose: {
      intro: 'Votre quotidien : lire la relève en arrivant, noter ce qui se passe, faire les suivis.',
      handover: {
        title: 'En début de quart : la relève',
        body: 'Ouvrir l’onglet Relève : ce qui s’est passé depuis votre dernière relève.\nLire chaque consigne prioritaire et toucher « J’ai lu cette consigne ».\nConfirmer les annonces de la direction (« J’ai lu cette annonce »).\nToucher « J’ai pris connaissance de la relève » : les notes ordinaires sont marquées comme lues.',
      },
      notes: {
        title: 'Écrire une note',
        body: 'Journal › « Nouvelle note » : résident, catégorie, ce qui s’est passé et ce que vous avez fait.\nLe micro permet de dicter au lieu de taper.\nVous pouvez corriger votre note pendant 24 heures ; l’ancienne version est conservée.',
      },
      followUps: {
        title: 'Les suivis',
        body: 'Suivis : les actions à faire issues d’une note.\n« Je m’en occupe » pour prendre un suivi de l’équipe, « Marquer fait » quand c’est réglé (une courte note de clôture aide l’équipe suivante).\nUn suivi en retard apparaît en rouge.',
      },
      messages: {
        title: 'Les messages',
        body: 'Messages privés, groupes, fil de toute l’équipe et annonces.\nUn message se corrige ou se retire pendant 15 minutes ; rien n’est supprimé.\nNe pas y écrire ce qui doit être noté au dossier d’un résident : c’est le journal qui fait foi.',
      },
      agenda: {
        title: 'Agenda et horaires',
        body: 'Agenda : rendez-vous des résidents et activités ; ceux des prochaines 24 heures apparaissent dans la relève.\nHoraires : vos quarts de la semaine.\nSur téléphone, ces deux pages sont dans le menu « Plus ».',
      },
      residents: {
        title: 'Les résidents',
        body: 'Fiche de chaque résident : chambre, contact d’urgence, consignes particulières, et ses notes.',
      },
    },
    infirmiere: {
      intro: 'En plus du travail d’équipe : les consignes prioritaires, les corrections, la gestion des résidents.',
      priority: {
        title: 'Consignes prioritaires',
        body: 'Cocher « Prioritaire » en écrivant une note : chaque employé devra la confirmer une à une à sa relève.\nLes employés en quart reçoivent une notification.\nUne consigne corrigée sur le fond doit être relue par tous.',
      },
      corrections: {
        title: 'Corriger ou annuler une note',
        body: 'Vous pouvez corriger toute note, à tout moment ; chaque version est conservée.\nAnnuler une note demande un motif ; elle reste visible, barrée.',
      },
      residents: {
        title: 'Gérer les résidents',
        body: 'Résidents › « Ajouter un résident » ; modifier une fiche ; noter un départ.\nNotes réservées : visibles seulement par l’infirmière et la responsable.\nStatistiques d’un résident : tendances par mois ou par année (chutes, sommeil…).',
      },
      announcements: {
        title: 'Annonces',
        body: 'Messages › Annonces : publier une consigne pour toute l’équipe.\nChacun confirme sa lecture ; « Lue par N — voir qui manque ».',
      },
    },
    responsable: {
      intro: 'En plus de tout ce que fait l’infirmière : l’équipe, les réglages de la résidence et la conformité.',
      security: {
        title: 'Double authentification',
        body: 'Obligatoire pour votre compte : un code de votre application d’authentification à chaque connexion.\nGardez vos codes de secours en lieu sûr ; de nouveaux se génèrent dans Mon profil.\nTéléphone et codes perdus : l’administration de la plateforme réinitialise votre double authentification.',
      },
      team: {
        title: 'L’équipe',
        body: 'Admin › Équipe › « Inviter un employé » : il reçoit un courriel et choisit lui-même son mot de passe.\nChanger un rôle ; désactiver un compte (ses sessions se ferment tout de suite).',
      },
      settings: {
        title: 'Réglages de la résidence',
        body: 'Admin › Catégories : les catégories de notes.\nAdmin › Quarts : les quarts types (jour, soir, nuit…).\nHoraires : placer les quarts de l’équipe, semaine par semaine.',
      },
      compliance: {
        title: 'Conformité et plaintes',
        body: 'Admin › Journal d’audit : qui a consulté ou modifié quoi.\nExport complet du dossier d’un résident (Loi 25) depuis sa fiche.\nAdmin › Messagerie : consulter une conversation en cas de plainte, avec un motif (tracé).',
      },
      features: {
        title: 'Fonctionnalités de la résidence',
        body: 'Admin › Fonctionnalités : ce que chaque rôle voit et peut faire, et les exceptions par personne (aussi indiquées dans Équipe).\nCes réglages font partie de l’offre convenue avec votre résidence : pour les changer, écrire à l’administration de la plateforme. Vous êtes prévenue par courriel de chaque changement.\nChanger le rôle d’un employé retire ses exceptions.',
      },
      assistance: {
        title: 'Accès d’assistance',
        body: 'Admin › Assistance : permettre à l’équipe de la plateforme de consulter la résidence pour régler un problème.\nDurée limitée, lecture seule, messagerie exclue ; chaque page consultée est inscrite au journal. Retirable à tout moment.',
      },
    },
    admin: {
      intro: 'Vous gérez les résidences et leurs responsables, jamais le contenu d’une résidence.',
      residences: {
        title: 'Les résidences',
        body: 'Résidences › « Nouvelle résidence » : nom, type, fuseau, et sa responsable (invitée par courriel).\nFiche d’une résidence : modifier, suspendre avec un motif (sessions fermées, données conservées), réactiver.\nResponsables : inviter, nommer un employé, renvoyer l’invitation, lien de mot de passe, réinitialiser la double authentification.',
      },
      features: {
        title: 'Fonctionnalités d’une résidence',
        body: 'Fiche d’une résidence › onglet Fonctionnalités : ce que chaque rôle voit et peut faire. Masqué : la page disparaît ; Consultation : lire sans écrire ; Complet : tout.\nCommencer par une formule (Complète, Essentielle, Journal infirmier), puis ajuster case par case : elle devient « Personnalisée ».\nUn réglage ne donne jamais plus que le rôle (« — (rôle) ») ; un module dont un autre dépend est signalé avant d’enregistrer (sans Journal, pas de Relève).\nExceptions par personne : un autre niveau pour un employé précis, avec un motif ; retirées d’office si son rôle change.\nRien n’est effacé : réactiver un module rend ses données. Chaque changement est inscrit au journal et la responsable reçoit un courriel ; il s’applique en moins d’une minute.',
      },
      security: {
        title: 'Sécurité',
        body: 'Comptes bloqués à débloquer, connexions refusées, événements suspects.\nEnvoi des courriels : vérifier la configuration avec un courriel d’essai.',
      },
      audit: {
        title: 'Journal de la plateforme',
        body: 'Toutes les actions des administrateurs ; elles figurent aussi au journal de la résidence concernée.',
      },
      assistance: {
        title: 'Aider une résidence',
        body: 'Seulement si sa responsable vous accorde un accès d’assistance : « Consulter (lecture seule) » sur le tableau de bord.\nUn bandeau orange rappelle les règles ; « Terminer l’accès » en sortant.',
      },
      admins: {
        title: 'Administrateurs',
        body: 'Inviter un autre administrateur ; jamais se désactiver soi-même.\nDernier recours (dernier admin sans téléphone) : npm run mfa:reset sur le serveur.',
      },
    },
  },
  tour: {
    progress: '{{n}} sur {{total}}',
    next: 'Suivant',
    prev: 'Précédent',
    skip: 'Quitter la visite',
    finish: 'Terminer',
    dialog: 'Visite guidée',
    offer: {
      title: 'Première visite ?',
      body: 'Une visite guidée de 2 minutes montre où se trouve chaque chose.',
      start: 'Commencer',
      later: 'Plus tard',
    },
    steps: {
      welcome: { title: 'Bienvenue dans le Journal de bord', body: 'Voici une courte visite de l’application. Vous pouvez la quitter à tout moment et la relancer depuis la page Aide.' },
      handoverTab: { title: 'La relève', body: 'Votre point de départ à chaque quart : ce qui s’est passé depuis votre dernière relève. La pastille indique les notes non lues.' },
      handoverAck: { title: 'J’ai pris connaissance', body: 'Après avoir lu, confirmez ici. Les consignes prioritaires se confirment d’abord une à une.' },
      journalNew: { title: 'Écrire une note', body: 'Résident, catégorie, ce qui s’est passé et ce que vous avez fait. Le micro permet de dicter la note.' },
      priority: { title: 'Consigne prioritaire', body: 'En écrivant une note, cochez « Prioritaire » : chaque employé devra la confirmer, et l’équipe en quart reçoit une notification.' },
      followUps: { title: 'Les suivis', body: 'Les actions à faire issues des notes. « Je m’en occupe » pour en prendre un, « Marquer fait » quand c’est réglé.' },
      messages: { title: 'Les messages', body: 'Messages privés, groupes, fil de l’équipe et annonces de la direction à confirmer.' },
      agenda: { title: 'Agenda et horaires', body: 'Rendez-vous des résidents et vos quarts de travail. Sur téléphone : dans le menu « Plus ».' },
      residents: { title: 'Les résidents', body: 'La fiche de chaque résident : chambre, contact d’urgence, consignes particulières et ses notes.' },
      residentsSupervisor: { title: 'Gérer les résidents', body: 'Ajouter un résident, modifier une fiche, lire les notes réservées et voir les statistiques (tendances par mois ou par année).' },
      admin: { title: 'L’administration', body: 'Inviter les employés, régler les catégories et les quarts, lire le journal d’audit. Sur téléphone : dans le menu « Plus ».' },
      teamInvite: { title: 'Inviter un employé', body: 'Il reçoit un courriel et choisit lui-même son mot de passe. Personne d’autre ne le connaît.' },
      assistance: { title: 'Accès d’assistance', body: 'Dans l’onglet Assistance, vous pouvez permettre à l’équipe de la plateforme de consulter la résidence, pour une durée limitée et en lecture seule.' },
      profile: { title: 'Mon profil', body: 'Votre photo ou avatar, votre mot de passe, la langue, les notifications sur ce téléphone et la double authentification. Sur téléphone : dans « Plus ».' },
      help: { title: 'Besoin d’aide ?', body: 'Les guides par rôle sont ici, et vous pouvez relancer cette visite quand vous voulez. Bonne utilisation !' },
      platformWelcome: { title: 'Bienvenue sur la plateforme', body: 'Vous gérez les résidences et leurs responsables. Le contenu d’une résidence ne s’ouvre qu’avec l’accord de sa responsable.' },
      platformNew: { title: 'Nouvelle résidence', body: 'Nom, type, fuseau horaire et sa responsable : elle reçoit une invitation par courriel, puis crée son équipe.' },
      platformSecurity: { title: 'Sécurité', body: 'Comptes bloqués, connexions refusées, et le courriel d’essai pour vérifier l’envoi des invitations.' },
      platformAudit: { title: 'Journal de la plateforme', body: 'Chaque action d’un administrateur est inscrite ici, et au journal de la résidence concernée.' },
      platformAdmins: { title: 'Administrateurs', body: 'Inviter un autre administrateur. Chacun configure sa double authentification à sa première connexion.' },
    },
  },
};
