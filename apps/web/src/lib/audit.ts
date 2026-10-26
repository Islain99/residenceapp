// Phrases du journal d'audit (journal de la résidence et journal de la
// plateforme), dans la langue de l'interface (i18n, admin.audit).
import type { AuditEntry } from '../api/types';
import i18n from '../i18n';
import type adminFr from '../i18n/fr/admin';
import { fullName } from './format';

type Audit = typeof adminFr.audit;
const t = i18n.t.bind(i18n);
// Libellé connu, sinon le code brut (action ou élément ajouté plus tard)
const action = (code: string) => (i18n.exists(`admin.audit.actions.${code}`)
  ? t(`admin.audit.actions.${code as keyof Audit['actions']}`) : code);
const entity = (code: string) => (i18n.exists(`admin.audit.entities.${code}`)
  ? t(`admin.audit.entities.${code as keyof Audit['entities']}`) : code);
const reason = (code: string) => (i18n.exists(`admin.audit.reasons.${code}`)
  ? t(`admin.audit.reasons.${code as keyof Audit['reasons']}`) : undefined);

// Fonctionnalités activables : nom du module et du niveau (platform.features)
const moduleName = (code: unknown) => (typeof code === 'string' && i18n.exists(`platform.features.modules.${code}`)
  ? i18n.t(`platform.features.modules.${code}` as 'platform.features.modules.journal') : String(code));
const levelName = (code: unknown) => (typeof code === 'string' && i18n.exists(`platform.features.levels.${code}`)
  ? i18n.t(`platform.features.levels.${code}` as 'platform.features.levels.full') : String(code));

// Pages consultées pendant un accès d'assistance (route de l'API → page)
const ROUTES: Record<string, keyof Audit['routes']> = {
  '/handover': 'handover',
  '/notes': 'notes',
  '/notes/:id': 'note',
  '/follow-ups': 'followUps',
  '/follow-ups/:id': 'followUp',
  '/residents': 'residents',
  '/residents/:id': 'resident',
  '/residents/:id/stats': 'stats',
  '/appointments': 'appointments',
  '/appointments/:id': 'appointment',
  '/shifts': 'shifts',
  '/shift-types': 'shiftTypes',
  '/users': 'users',
  '/staff': 'staff',
  '/note-categories': 'categories',
  '/audit': 'audit',
  '/assistance': 'assistance',
};

// Actions que la personne fait sur son propre compte (pas de « compte de X »)
const SELF_ACTIONS = ['login', 'logout', 'login_failed', 'refresh_reuse', 'account_activated', 'password_reset',
  'password_reset_requested', 'handover', 'mfa_enabled', 'mfa_backup_codes', 'password_change',
  'password_change_failed', 'profile_update'];

export function describeAudit(entry: AuditEntry): string {
  const d = entry.details ?? {};
  switch (entry.action) {
    case 'assistance_view':
      return t('admin.audit.assistanceView', { page: t(`admin.audit.routes.${ROUTES[String(d.route)] ?? 'page'}`) });
    case 'assistance_grant':
      return t('admin.audit.assistanceGrant', { hours: d.hours });
    case 'assistance_revoke':
      return t('admin.audit.assistanceRevoke');
    case 'assistance_start':
      return t('admin.audit.assistanceStart');
    case 'assistance_end':
      return t('admin.audit.assistanceEnd');
    case 'feature_exception':
      return t('admin.audit.featureException', {
        name: entry.target ? fullName(entry.target) : '', module: moduleName(d.feature), level: levelName(d.to),
      });
    case 'feature_exception_revoke':
      return d.reason === 'role_changed'
        ? t('admin.audit.featureExceptionRoleChanged', { name: entry.target ? fullName(entry.target) : '' })
        : t('admin.audit.featureExceptionRevoke', { name: entry.target ? fullName(entry.target) : '', module: moduleName(d.feature) });
    case 'feature_update':
      return t('admin.audit.featureUpdate', { count: Array.isArray(d.changes) ? d.changes.length : 0 });
  }
  const what = action(entry.action);
  if (entry.entity === 'user' && SELF_ACTIONS.includes(entry.action)) {
    const why = typeof d.reason === 'string' ? reason(d.reason) : undefined;
    const locked = d.locked ? t('admin.audit.locked') : '';
    return why ? t('admin.audit.withReason', { action: what, reason: why }) + locked : what + locked;
  }
  if (entry.entity === 'user' && entry.target) {
    const direct = ['revoke_sessions', 'reset_link', 'mfa_reset'].includes(entry.action);
    return t(direct ? 'admin.audit.actionOn' : 'admin.audit.accountOf', { action: what, name: fullName(entry.target) });
  }
  const residenceReason = entry.entity === 'residence' && typeof d.reason === 'string'
    ? t('admin.audit.residenceReason', { reason: d.reason }) : '';
  return t('admin.audit.entityAction', { action: what, entity: entity(entry.entity) }) + residenceReason;
}

// Auteur de la ligne : la personne qui a agi, sinon le compte visé
export function auditActor(entry: AuditEntry): string {
  return entry.user ? fullName(entry.user) : entry.target ? fullName(entry.target) : t('admin.audit.unknownEmail');
}
