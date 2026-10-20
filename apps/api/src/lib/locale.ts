// Langue des comptes (users.locale, migration 0013) et textes envoyés par le
// serveur : courriels et notifications push, en français et en anglais.
//
// Règle du projet : tout texte destiné à une personne existe dans les deux
// langues. Localized<T> l'impose : un texte sans sa version anglaise ne
// compile pas. Les messages d'erreur de l'API restent en français ; l'interface
// en anglais les traduit d'après leur code (apps/web/src/i18n/api-errors.ts).
import { Type } from '@fastify/type-provider-typebox';

export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const LocaleSchema = Type.Union(LOCALES.map((l) => Type.Literal(l)));
export type Localized<T> = Record<Locale, T>;

// Valeur de la base (ou absente) → langue sûre ; français par défaut
export const asLocale = (value: string | null | undefined): Locale => (value === 'en' ? 'en' : 'fr');

// ---------------------------------------------------------------------
// Courriels
// ---------------------------------------------------------------------
export const MAIL_TEXT = {
  fr: {
    hello: (name: string) => `Bonjour ${name},`,
    buttonFallback: 'Si le bouton ne fonctionne pas, copier ce lien :',
    invite: {
      subject: (residence: string) => `Votre accès au journal de bord — ${residence}`,
      body: (by: string, residence: string) => `${by} vous a créé un accès au journal de bord de ${residence}.`,
      validity: 'Pour l’activer, choisissez votre mot de passe. Le lien est valable 72 heures.',
      button: 'Choisir mon mot de passe',
      footer: 'Si vous n’attendiez pas ce message, vous pouvez l’ignorer.',
      platformSender: 'L’équipe de la plateforme',
      platformPlace: 'l’administration de la plateforme',
    },
    reset: {
      subject: 'Réinitialiser votre mot de passe — Journal de bord',
      body: 'Vous avez demandé à changer votre mot de passe. Le lien est valable 1 heure et ne sert qu’une fois.',
      button: 'Choisir un nouveau mot de passe',
      footer: 'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.',
    },
    passwordChanged: {
      subject: 'Votre mot de passe a été changé',
      body: 'Le mot de passe de votre compte du journal de bord vient d’être changé.',
      warning: 'Si ce n’est pas vous, choisissez tout de suite un nouveau mot de passe et prévenez votre responsable.',
      button: 'Choisir un nouveau mot de passe',
      footer: 'Courriel automatique, ne pas y répondre.',
    },
    test: {
      subject: 'Essai d’envoi — Journal de bord',
      body: 'Ce courriel confirme que l’envoi fonctionne (invitations, mots de passe oubliés).',
    },
  },
  en: {
    hello: (name: string) => `Hello ${name},`,
    buttonFallback: 'If the button doesn’t work, copy this link:',
    invite: {
      subject: (residence: string) => `Your logbook access — ${residence}`,
      body: (by: string, residence: string) => `${by} created an access for you to the ${residence} logbook.`,
      validity: 'To activate it, choose your password. The link is valid for 72 hours.',
      button: 'Choose my password',
      footer: 'If you weren’t expecting this message, you can ignore it.',
      platformSender: 'The platform team',
      platformPlace: 'the platform administration',
    },
    reset: {
      subject: 'Reset your password — Logbook',
      body: 'You asked to change your password. The link is valid for 1 hour and works only once.',
      button: 'Choose a new password',
      footer: 'If you didn’t make this request, ignore this message: your current password still works.',
    },
    passwordChanged: {
      subject: 'Your password was changed',
      body: 'The password of your logbook account was just changed.',
      warning: 'If this wasn’t you, choose a new password right away and tell your manager.',
      button: 'Choose a new password',
      footer: 'Automatic email, please don’t reply.',
    },
    test: {
      subject: 'Test email — Logbook',
      body: 'This email confirms that sending works (invitations, forgotten passwords).',
    },
  },
} satisfies Localized<unknown>;

// ---------------------------------------------------------------------
// Notifications push : jamais de nom de résident ni de contenu (Loi 25)
// ---------------------------------------------------------------------
export const PUSH_TEXT = {
  fr: {
    priority: { title: 'Consigne prioritaire', body: 'Nouvelle consigne à lire dans la relève.' },
    announcement: (author: string) => ({ title: `Annonce de ${author}`, body: 'Nouvelle annonce à lire et à confirmer.' }),
    message: (author: string) => ({ title: `Message de ${author}`, body: 'Nouveau message. Ouvrez l’application pour le lire.' }),
    groupMessage: (group: string, author: string) => ({ title: `${group} — ${author}`, body: 'Nouveau message. Ouvrez l’application pour le lire.' }),
    followUpAssigned: { title: 'Suivi assigné', body: 'Un suivi vous a été confié. Ouvrez l’application pour le voir.' },
    followUpDue: { title: 'Suivi à échéance', body: 'Un suivi arrive à échéance. Ouvrez l’application pour le voir.' },
    test: { title: 'Notifications activées', body: 'Vous recevrez ici les avis du journal de bord.' },
  },
  en: {
    priority: { title: 'Priority instruction', body: 'A new instruction is waiting in the handover.' },
    announcement: (author: string) => ({ title: `Announcement from ${author}`, body: 'New announcement to read and confirm.' }),
    message: (author: string) => ({ title: `Message from ${author}`, body: 'New message. Open the app to read it.' }),
    groupMessage: (group: string, author: string) => ({ title: `${group} — ${author}`, body: 'New message. Open the app to read it.' }),
    followUpAssigned: { title: 'Follow-up assigned', body: 'A follow-up was assigned to you. Open the app to see it.' },
    followUpDue: { title: 'Follow-up due', body: 'A follow-up is coming due. Open the app to see it.' },
    test: { title: 'Notifications on', body: 'You’ll get logbook alerts here.' },
  },
} satisfies Localized<unknown>;

// Même avis dans les deux langues, à partir des textes ci-dessus
export function pushIn<T>(pick: (text: (typeof PUSH_TEXT)['fr']) => T): Localized<T> {
  return { fr: pick(PUSH_TEXT.fr), en: pick(PUSH_TEXT.en as (typeof PUSH_TEXT)['fr']) };
}
