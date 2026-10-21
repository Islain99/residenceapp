// Visite guidée : étapes par rôle et état de la visite en cours.
//
// Une étape peut ouvrir une page (route) et désigner un élément à mettre en
// évidence par son attribut data-tour. Plusieurs cibles possibles : la
// première visible gagne (ex. l'onglet « Agenda » sur ordinateur, sinon le
// bouton « Plus » sur téléphone). Sans cible visible : carte au centre.
//
// « Visite déjà vue » : gardé sur l'appareil (localStorage), par personne.
import { useSyncExternalStore } from 'react';
import type helpFr from '../i18n/fr/help';
import type { Role } from '../api/types';

export type TourStepKey = keyof typeof helpFr.tour.steps;
export type TourId = 'prepose' | 'infirmiere' | 'responsable' | 'admin';

export interface TourStep {
  key: TourStepKey;
  route?: string;
  targets?: string[];
}

const COMMON_START: TourStep[] = [
  { key: 'welcome', route: '/' },
  { key: 'handoverTab', route: '/', targets: ['nav-handover'] },
  { key: 'handoverAck', route: '/', targets: ['handover-ack'] },
  { key: 'journalNew', route: '/journal', targets: ['journal-new', 'nav-journal'] },
];

const COMMON_MIDDLE: TourStep[] = [
  { key: 'followUps', route: '/suivis', targets: ['followup-take', 'nav-followUps'] },
  { key: 'messages', route: '/messages', targets: ['messages-new', 'nav-messages'] },
  { key: 'agenda', route: '/agenda', targets: ['nav-agenda', 'nav-more'] },
];

const COMMON_END: TourStep[] = [
  { key: 'profile', targets: ['header-profile', 'nav-more'] },
  { key: 'help', targets: ['header-help', 'nav-more'] },
];

export const TOURS: Record<TourId, TourStep[]> = {
  prepose: [
    ...COMMON_START,
    ...COMMON_MIDDLE,
    { key: 'residents', route: '/residents', targets: ['nav-residents'] },
    ...COMMON_END,
  ],
  infirmiere: [
    ...COMMON_START,
    { key: 'priority', route: '/journal', targets: ['journal-new', 'nav-journal'] },
    ...COMMON_MIDDLE,
    { key: 'residentsSupervisor', route: '/residents', targets: ['residents-add', 'nav-residents'] },
    ...COMMON_END,
  ],
  responsable: [
    ...COMMON_START,
    { key: 'priority', route: '/journal', targets: ['journal-new', 'nav-journal'] },
    ...COMMON_MIDDLE,
    { key: 'residentsSupervisor', route: '/residents', targets: ['residents-add', 'nav-residents'] },
    { key: 'admin', route: '/administration/equipe', targets: ['nav-admin', 'nav-more'] },
    { key: 'teamInvite', route: '/administration/equipe', targets: ['team-invite'] },
    { key: 'assistance', route: '/administration/equipe', targets: ['admin-tab-assistance'] },
    ...COMMON_END,
  ],
  admin: [
    { key: 'platformWelcome', route: '/plateforme' },
    { key: 'platformNew', route: '/plateforme', targets: ['platform-new'] },
    { key: 'platformSecurity', route: '/plateforme/securite', targets: ['nav-security'] },
    { key: 'platformAudit', route: '/plateforme/journal', targets: ['nav-platformAudit'] },
    { key: 'platformAdmins', route: '/plateforme/administrateurs', targets: ['platform-admins-invite', 'nav-admins'] },
    { key: 'profile', targets: ['header-profile'] },
    { key: 'help', targets: ['header-help'] },
  ],
};

export const tourForRole = (role: Role): TourId => role;

// ------------------------------------------------------------- État courant

interface TourState { id: TourId; step: number }

let state: TourState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function startTour(id: TourId): void {
  state = { id, step: 0 };
  emit();
}

export function goToStep(step: number): void {
  if (!state) return;
  state = { ...state, step };
  emit();
}

export function stopTour(): void {
  state = null;
  emit();
}

export function useTourState(): TourState | null {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => state,
  );
}

// ------------------------------------------------- « Déjà vue » (par appareil)

const doneKey = (userId: string) => `tour-done:${userId}`;

export function tourSeen(userId: string): boolean {
  try {
    return localStorage.getItem(doneKey(userId)) === '1';
  } catch {
    return true;   // stockage bloqué : ne pas proposer la visite à chaque page
  }
}

export function markTourSeen(userId: string): void {
  try {
    localStorage.setItem(doneKey(userId), '1');
  } catch {
    // stockage indisponible
  }
}
