// Formes des réponses de l'API (apps/api/src/routes, apps/api/src/lib).

export type Role = 'prepose' | 'infirmiere' | 'responsable' | 'admin';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  residenceId: string | null;
}

export interface Person {
  id: string;
  firstName: string;
  lastName: string;
}

export interface Category {
  id: string;
  label: string;
}

// Gestion des catégories (responsable)
export interface ManagedCategory extends Category {
  sortOrder: number;
  isActive: boolean;
}

// Journal d'audit (responsable)
export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  entity: string;
  entityId: string | null;
  user: Person | null;          // qui a agi
  target: Person | null;        // compte visé (élément « compte »)
  details: Record<string, unknown> | null;
  ip: string | null;
}

export interface AuditPage {
  items: AuditEntry[];
  nextCursor: string | null;
}

export interface ResidentRef {
  id: string;
  firstName: string;
  lastName: string;
  room: string | null;
}

export interface Note {
  id: string;
  occurredAt: string;
  description: string;
  intervention: string | null;
  isPriority: boolean;
  isPositive: boolean;
  status: 'active' | 'annulee';
  cancelReason: string | null;
  cancelledAt: string | null;
  cancelledBy: Person | null;
  author: Person;
  category: Category;
  resident: ResidentRef | null;
  versionCount: number;
  // Lecture confirmée. Consigne prioritaire corrigée depuis ma lecture : false (à relire)
  readByMe: boolean;
  modifiedSinceRead: boolean;   // note ordinaire corrigée après ma lecture
  contentEditedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteVersion {
  editedAt: string;
  editedBy: Person;
  previous: {
    description: string;
    intervention: string | null;
    categoryId: string;
    residentId: string | null;
    occurredAt: string;
    isPriority: boolean;
    isPositive: boolean;
  };
}

export interface FollowUp {
  id: string;
  description: string;
  dueAt: string | null;
  isOverdue: boolean;
  assignedTo: Person | null;
  createdBy: Person | null;
  createdAt: string;
  closedAt: string | null;
  closedBy: Person | null;
  closingNote: string | null;
  note: { id: string; occurredAt: string; excerpt: string };
  resident: ResidentRef | null;
}

export interface NoteDetail extends Note {
  versions: NoteVersion[];
  followUps: FollowUp[];
  reads: { user: Person; readAt: string }[];
  unreadBy: Person[];           // consigne prioritaire : qui ne l'a pas encore lue
}

export interface NotePage {
  items: Note[];
  nextCursor: string | null;
}

export interface NoteInput {
  occurredAt: string;
  categoryId: string;
  residentId: string | null;
  description: string;
  intervention: string | null;
  isPriority: boolean;
  isPositive: boolean;
}

export interface ResidentSummary extends ResidentRef {
  status: 'actif' | 'parti';
  specialInstructions: string | null;
}

export interface Resident extends ResidentSummary {
  birthDate: string | null;
  emergencyContact: string | null;
  admittedAt: string | null;
  leftAt: string | null;
  restrictedNotes?: string | null;   // présent seulement pour infirmière / responsable
  createdAt: string;
  updatedAt: string;
}

export interface ResidentInput {
  firstName: string;
  lastName: string;
  room: string | null;
  birthDate: string | null;
  emergencyContact: string | null;
  specialInstructions: string | null;
  restrictedNotes?: string | null;
  admittedAt: string | null;
}

export interface StaffMember extends Person {
  role: Role;
}

export interface Account extends StaffMember {
  email: string;
  isActive: boolean;
  status: 'invited' | 'active' | 'inactive';
  lastLoginAt: string | null;
  invitationExpiresAt: string | null;
}

export interface AccountInput {
  email: string;
  firstName: string;
  lastName: string;
  role: Exclude<Role, 'admin'>;
}

export interface Handover {
  generatedAt: string;
  since: string;
  lastHandoverAt: string | null;
  notes: Note[];
  truncated: boolean;
  counts: { notes: number; priority: number; unread: number };
  followUps: FollowUp[];
  appointments: Appointment[];   // prochaines 24 h
}

export type AppointmentKind = 'medical' | 'transport' | 'visite' | 'activite' | 'reunion' | 'autre';

export interface Appointment {
  id: string;
  kind: AppointmentKind;
  title: string;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  details: string | null;
  status: 'prevu' | 'annule';
  cancelReason: string | null;
  cancelledAt: string | null;
  cancelledBy: Person | null;
  resident: ResidentRef | null;
  createdBy: Person;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentInput {
  kind: AppointmentKind;
  title: string;
  residentId: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  details: string | null;
}

export interface ShiftType {
  id: string;
  label: string;
  startTime: string;   // HH:MM, heure locale
  endTime: string;     // ≤ startTime : finit le lendemain
  sortOrder: number;
  isActive: boolean;
}

export interface Shift {
  id: string;
  workDate: string;    // AAAA-MM-JJ, jour où le quart commence
  startTime: string;
  endTime: string;
  overnight: boolean;
  adjusted: boolean;   // heures différentes du quart type
  notes: string | null;
  shiftType: { id: string; label: string };
  user: Person & { role: Role };
}

export type StatsPeriod = 'month' | 'year';

export interface ResidentStats {
  resident: Person;
  period: { unit: StatsPeriod; start: string; end: string; previousStart: string };
  totals: {
    notes: number; positive: number; priority: number;
    previousNotes: number; previousPositive: number; previousPriority: number;
  };
  categories: { id: string; label: string; count: number; previousCount: number }[];
  timeline: { bucket: string; total: number; byCategory: Record<string, number> }[];   // jour (mois) ou mois (année)
  timeOfDay: { slot: 'nuit' | 'matin' | 'apres_midi' | 'soir'; count: number }[];
  followUps: { opened: number; closed: number; openNow: number };
  appointments: number;
}
