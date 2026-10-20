// Icônes de la navigation (barre du bas sur téléphone, menu « Plus ») : traits
// de même épaisseur, couleur du texte (currentColor). Dessinées ici plutôt que
// des caractères (◷ ✉…), qui s'affichent différemment d'un téléphone à
// l'autre (l'enveloppe devient un émoji en couleur sur iPhone).
import type { ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  // Relève : presse-papiers coché
  releve: <>
    <rect x="8" y="3" width="8" height="4" rx="1" />
    <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
    <path d="m9 14 2 2 4-4" />
  </>,
  // Journal : livre ouvert
  journal: <>
    <path d="M2.5 5H8a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2.5z" />
    <path d="M21.5 5H16a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h6.5z" />
  </>,
  // Suivis : cercle coché
  suivis: <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12 2.5 2.5 5-5" />
  </>,
  // Messages : bulle
  messages: <path d="M20.5 11.5a8 8 0 0 1-11.7 7.1L3.5 20l1.4-4.8a8 8 0 1 1 15.6-3.7z" />,
  // Agenda : calendrier
  agenda: <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M8 3v4M16 3v4M3.5 10h17" />
  </>,
  // Horaires : horloge
  horaires: <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </>,
  // Résidents : deux personnes
  residents: <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.2A6.5 6.5 0 0 1 21.5 20" />
  </>,
  // Administration : réglages (curseurs)
  admin: <>
    <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="17" cy="18" r="2" />
  </>,
  // Mon profil : silhouette
  profil: <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </>,
  // Plus : trois points
  plus: <>
    <circle cx="5" cy="12" r="1.3" fill="currentColor" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    <circle cx="19" cy="12" r="1.3" fill="currentColor" />
  </>,
};

export type NavIconName = keyof typeof PATHS;

export function NavIcon({ name, className = 'size-6' }: { name: NavIconName; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}
