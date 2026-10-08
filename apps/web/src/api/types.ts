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
  readByMe: boolean;
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

export interface Handover {
  generatedAt: string;
  since: string;
  lastHandoverAt: string | null;
  notes: Note[];
  truncated: boolean;
  counts: { notes: number; priority: number; unread: number };
  followUps: FollowUp[];
}
