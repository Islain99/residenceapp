// Aide : guide d'utilisation par rôle (le sien par défaut, les autres
// consultables) et lancement de la visite guidée interactive.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Role } from '../api/types';
import { useAuth, useUser } from '../auth/session';
import { Button, Card, Chip, PageHeader } from '../components/ui';
import type helpFr from '../i18n/fr/help';
import { startTour, tourForRole } from '../lib/tour';

type Guides = typeof helpFr.guides;

// Sections de chaque guide, dans l'ordre de lecture
const SECTIONS: { [R in keyof Guides]: Exclude<keyof Guides[R], 'intro'>[] } = {
  prepose: ['handover', 'notes', 'followUps', 'messages', 'agenda', 'residents'],
  infirmiere: ['priority', 'corrections', 'residents', 'announcements'],
  responsable: ['security', 'team', 'settings', 'compliance', 'assistance'],
  admin: ['residences', 'security', 'audit', 'assistance', 'admins'],
};

// Ce que chaque rôle doit lire : l'infirmière fait tout ce que fait le
// préposé, la responsable tout ce que fait l'infirmière
const READS: Record<Role, (keyof Guides)[]> = {
  prepose: ['prepose'],
  infirmiere: ['infirmiere', 'prepose'],
  responsable: ['responsable', 'infirmiere', 'prepose'],
  admin: ['admin'],
};

const GENERAL = ['install', 'notifications', 'shared', 'privacy', 'language'] as const;
const ROLES: Role[] = ['prepose', 'infirmiere', 'responsable', 'admin'];

// Corps de texte : une ligne = un point de liste
function Lines({ text }: { text: string }) {
  const lines = text.split('\n');
  if (lines.length === 1) return <p className="text-sm">{text}</p>;
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
      {lines.map((line) => <li key={line}>{line}</li>)}
    </ul>
  );
}

export function HelpPage() {
  const { t } = useTranslation();
  const user = useUser();
  const { assistance } = useAuth();
  const [role, setRole] = useState<Role>(user.role);

  return (
    <>
      <PageHeader title={t('help.title')} subtitle={t('help.subtitle')} />

      {!assistance && (
        <Card className="mb-6 flex flex-col gap-3 border-primary p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">{t('help.tourHint')}</p>
          <Button variant="primary" onClick={() => startTour(tourForRole(user.role))}>{t('help.startTour')}</Button>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label={t('help.chooseRole')}>
        <span className="text-sm font-medium">{t('help.chooseRole')}</span>
        {ROLES.map((r) => <Chip key={r} active={role === r} onClick={() => setRole(r)}>{t(`help.roles.${r}`)}</Chip>)}
      </div>

      <div className="flex flex-col gap-6">
        {READS[role].map((guide, index) => (
          <section key={guide}>
            <h2 className="mb-1 text-lg font-semibold">{t(`help.roles.${guide}`)}</h2>
            <p className="mb-3 text-sm text-muted">{t(`help.guides.${guide}.intro`)}</p>
            <div className="grid gap-3 md:grid-cols-2">
              {SECTIONS[guide].map((section) => (
                <Card key={String(section)} className="p-4">
                  <h3 className="mb-2 font-semibold">{t(`help.guides.${guide}.${String(section)}.title` as never)}</h3>
                  <Lines text={t(`help.guides.${guide}.${String(section)}.body` as never)} />
                </Card>
              ))}
            </div>
            {index === 0 && READS[role].length > 1 && <hr className="mt-6 border-line" />}
          </section>
        ))}

        <section>
          <h2 className="mb-3 text-lg font-semibold">{t('help.general.title')}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {GENERAL.map((key) => (
              <Card key={key} className="p-4">
                <h3 className="mb-2 font-semibold">{t(`help.general.${key}.title`)}</h3>
                <Lines text={t(`help.general.${key}.body`)} />
              </Card>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
