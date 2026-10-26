// Nom d'un résident : lien vers sa fiche, ou simple texte si la page
// Résidents est masquée pour la personne (fonctionnalités activables)
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useAccess } from '../lib/access';

export function ResidentLink({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const { can } = useAccess();
  if (!can('residents')) return <span className={className?.replace('hover:underline', '')}>{children}</span>;
  return <Link to={`/residents/${id}`} className={className}>{children}</Link>;
}
