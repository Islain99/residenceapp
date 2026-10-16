// Phrases du journal d'audit (journal de la résidence et journal de la plateforme).
import type { AuditEntry } from '../api/types';
import { fullName } from './format';

const ACTIONS: Record<string, string> = {
  view: 'a consulté',
  create: 'a créé',
  update: 'a modifié',
  cancel: 'a annulé',
  close: 'a fermé',
  export: 'a exporté',
  login: 's’est connecté·e',
  login_failed: 'connexion refusée',
  logout: 's’est déconnecté·e',
  refresh_reuse: 'réutilisation de session suspecte',
  invite: 'a invité',
  account_activated: 'a activé son compte',
  password_reset_requested: 'a demandé un nouveau mot de passe',
  password_reset: 'a changé son mot de passe',
  deactivate: 'a désactivé',
  reactivate: 'a réactivé',
  handover: 'a pris connaissance de la relève',
  suspend: 'a suspendu',
  unlock: 'a débloqué',
  revoke_sessions: 'a fermé toutes les sessions de',
  reset_link: 'a envoyé un lien de réinitialisation à',
  consult: 'a consulté (plainte)',
  retract: 'a retiré',
  add_members: 'a ajouté des membres à',
  leave: 'a quitté',
  mfa_enabled: 'a activé la double authentification',
  mfa_backup_codes: 'a généré de nouveaux codes de secours',
  mfa_reset: 'a réinitialisé la double authentification de',
  email_test: 'a envoyé un courriel d’essai',
};

const ENTITY_NAMES: Record<string, string> = {
  resident: 'le dossier d’un résident',
  note: 'une note',
  follow_up: 'un suivi',
  user: 'un compte',
  note_category: 'une catégorie',
  handover: 'la relève',
  residence: 'la résidence',
  conversation: 'une conversation',
  message: 'un message',
};

const REASONS: Record<string, string> = {
  bad_password: 'mauvais mot de passe',
  unknown_email: 'courriel inconnu',
  inactive: 'compte désactivé',
  not_activated: 'invitation non acceptée',
  locked: 'compte bloqué',
  bad_mfa_code: 'mauvais code de double authentification',
};

// Pages consultées pendant un accès d'assistance
const ROUTES: Record<string, string> = {
  '/handover': 'la relève',
  '/notes': 'le journal',
  '/notes/:id': 'une note',
  '/follow-ups': 'les suivis',
  '/follow-ups/:id': 'un suivi',
  '/residents': 'la liste des résidents',
  '/residents/:id': 'le dossier d’un résident',
  '/residents/:id/stats': 'les statistiques d’un résident',
  '/appointments': 'l’agenda',
  '/appointments/:id': 'un rendez-vous',
  '/shifts': 'les horaires',
  '/shift-types': 'les quarts',
  '/users': 'l’équipe',
  '/staff': 'la liste de l’équipe',
  '/note-categories': 'les catégories',
  '/audit': 'le journal d’audit',
  '/assistance': 'les accès d’assistance',
};

const SELF_ACTIONS = ['login', 'logout', 'login_failed', 'refresh_reuse', 'account_activated',
  'password_reset', 'password_reset_requested', 'handover', 'mfa_enabled', 'mfa_backup_codes', 'email_test'];

export function describeAudit(entry: AuditEntry): string {
  const d = entry.details ?? {};
  switch (entry.action) {
    case 'assistance_view':
      return `a consulté ${ROUTES[String(d.route)] ?? 'une page'} (accès d’assistance)`;
    case 'assistance_grant':
      return `a accordé un accès d’assistance (${d.hours} h)`;
    case 'assistance_revoke':
      return 'a retiré l’accès d’assistance';
    case 'assistance_start':
      return 'a ouvert l’accès d’assistance';
    case 'assistance_end':
      return 'a terminé l’accès d’assistance';
  }
  const action = ACTIONS[entry.action] ?? entry.action;
  if (entry.entity === 'user' && SELF_ACTIONS.includes(entry.action)) {
    const reason = typeof d.reason === 'string' ? REASONS[d.reason] : undefined;
    const locked = d.locked ? ' — compte bloqué' : '';
    return reason ? `${action} (${reason})${locked}` : action;
  }
  if (entry.entity === 'user' && entry.target) {
    const object = ['revoke_sessions', 'reset_link', 'mfa_reset'].includes(entry.action) ? '' : 'le compte de ';
    return `${action} ${object}${fullName(entry.target)}`;
  }
  const reason = entry.entity === 'residence' && typeof d.reason === 'string' ? ` — motif : ${d.reason}` : '';
  return `${action} ${ENTITY_NAMES[entry.entity] ?? entry.entity}${reason}`;
}

// Auteur de la ligne : la personne qui a agi, sinon le compte visé
export function auditActor(entry: AuditEntry): string {
  return entry.user ? fullName(entry.user) : entry.target ? fullName(entry.target) : 'Courriel inconnu';
}
