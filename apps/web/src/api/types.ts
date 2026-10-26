// Formes des réponses de l'API (apps/api/src/routes, apps/api/src/lib).

export type Role = 'prepose' | 'infirmiere' | 'responsable' | 'admin';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  residenceId: string | null;
  phone: string | null;
  avatar: string | null;         // avatar illustré « style:nom » (lib/avatar.ts) ; null : initiales
  avatarColor: string | null;    // null : couleur tirée de l'id (lib/avatar.ts)
  locale: 'fr' | 'en';           // langue du compte : interface, courriels, notifications
}

// Mon profil (PATCH /auth/me)
export interface ProfileInput {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  avatar?: string | null;
  avatarColor?: string | null;
  locale?: 'fr' | 'en';
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
  phone: string | null;
  avatar: string | null;
  avatarColor: string | null;
}

export interface AccountInput {
  email: string;
  firstName: string;
  lastName: string;
  role: Exclude<Role, 'admin'>;
  locale?: 'fr' | 'en';    // langue des courriels et des notifications (français par défaut)
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

// ---------------------------------------------------------------------
// Messagerie
// ---------------------------------------------------------------------
export type ConversationKind = 'direct' | 'group' | 'team' | 'announcements';

export interface ConversationMember extends Person {
  isActive: boolean;
}

export interface Conversation {
  id: string;
  kind: ConversationKind;
  title: string;
  members: ConversationMember[];     // privée et groupe ; vide pour Équipe et Annonces
  memberCount: number;
  createdBy: string | null;
  lastMessage: { id: string; excerpt: string | null; author: Person; createdAt: string } | null;
  lastMessageAt: string | null;
  unreadCount: number;
  pendingAcks: number;               // annonces à confirmer
  canPost: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  author: Person;
  body: string | null;               // null : message retiré
  createdAt: string;
  editedAt: string | null;
  retractedAt: string | null;
  mine: boolean;
  editableUntil: string | null;      // mon message, modifiable jusqu'à cette heure
  ack: { ackedByMe: boolean; count: number } | null;   // annonces seulement
}

export interface MessagePage {
  items: Message[];
  nextCursor: string | null;
}

export interface MessagingSummary {
  unread: number;
  announcements: Message[];          // annonces que je n'ai pas encore confirmées
}

export interface AnnouncementAcks {
  acked: { user: Person; ackedAt: string }[];
  pending: Person[];
}

export interface AdminConversation {
  id: string;
  kind: 'direct' | 'group';
  title: string | null;
  members: Person[];
  messageCount: number;
  lastMessageAt: string | null;
}

export interface ConsultedMessage {
  id: string;
  author: Person;
  body: string;
  createdAt: string;
  editedAt: string | null;
  retractedAt: string | null;
  versions: { body: string; replacedAt: string }[];
}

// ---------------------------------------------------------------------
// Administration de la plateforme et accès d'assistance
// ---------------------------------------------------------------------
export interface ResidenceRef {
  id: string;
  name: string;
}

export interface PlatformResidence {
  id: string;
  name: string;
  type: 'RPA' | 'RI';
  timezone: string;
  isActive: boolean;
  createdAt: string;
  staffActive: number;
  responsablesActive: number;
  residentsActive: number;
  notesLast30Days: number;
  lastLoginAt: string | null;
  lockedAccounts: number;
  failedLogins24h: number;
  assistanceUntil: string | null;
  formula: FeatureFormula;
}

// Fonctionnalités activables (API : lib/features.ts)
export type FeatureKey = 'handover' | 'journal' | 'priority' | 'followUps' | 'messaging' | 'announcements'
  | 'agenda' | 'schedule' | 'residents' | 'stats' | 'dictation';
export type FeatureLevel = 'off' | 'read' | 'full';
export type FeatureRole = 'prepose' | 'infirmiere' | 'responsable';
export type FeatureFormula = 'complete' | 'essential' | 'nurseJournal' | 'custom';
export type FeatureSettings = Partial<Record<FeatureKey, Partial<Record<FeatureRole, FeatureLevel>>>>;
export type FeatureGrid = Record<FeatureRole, Record<FeatureKey, FeatureLevel>>;

export interface FeatureNeed { feature: FeatureKey; min: FeatureLevel }

export interface FeatureDef {
  key: FeatureKey;
  levels: FeatureLevel[];
  ceiling: Record<FeatureRole, FeatureLevel>;
  requires: FeatureNeed[];
  requiresAny: FeatureNeed[];
}

export interface PlatformFeatures {
  residence: { id: string; name: string };
  formula: FeatureFormula;
  settings: FeatureSettings;
  effective: FeatureGrid;
  catalogue: FeatureDef[];
  formulas: Record<Exclude<FeatureFormula, 'custom'>, FeatureSettings>;
  updatedAt: string | null;
  updatedBy: Person | null;
  exceptions: FeatureException[];
  staff: (Person & { role: FeatureRole })[];
}

// Exception pour une personne : remplace le niveau de son rôle pour un module
export interface FeatureException {
  id: string;
  user: Person & { role: FeatureRole };
  feature: FeatureKey;
  level: FeatureLevel;
  roleLevel: FeatureLevel;
  effective: FeatureLevel;
  reason: string | null;
  createdAt: string;
  createdBy: Person | null;
}

export interface FeatureChange { role: FeatureRole; feature: FeatureKey; from: FeatureLevel; to: FeatureLevel }

export interface PlatformAccount {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  status: 'invited' | 'active' | 'inactive';
  lastLoginAt: string | null;
  lockedUntil: string | null;
  invitationExpiresAt: string | null;
  mfaEnabled: boolean;
}

export interface AssistanceGrant {
  id: string;
  residenceId: string;
  status: 'active' | 'expired' | 'revoked';
  reason: string | null;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  grantedBy: Person;
  revokedBy: Person | null;
  views: number;
}

export interface OpenAssistanceGrant extends AssistanceGrant {
  residence: ResidenceRef;
}

export interface PlatformResidenceDetail {
  residence: PlatformResidence;
  responsables: PlatformAccount[];
  staff: (Person & { role: Role })[];
  assistance: AssistanceGrant[];
}

export interface NewResidenceInput {
  name: string;
  type: 'RPA' | 'RI';
  timezone: string;
  responsable: { email: string; firstName: string; lastName: string; locale?: 'fr' | 'en' };
}

export interface PlatformSecurity {
  locked: (Person & { email: string; role: Role; residence: ResidenceRef | null; lockedUntil: string })[];
  failedLogins24h: { residence: ResidenceRef | null; count: number }[];
  events: { id: string; at: string; action: string; user: Person | null; residence: ResidenceRef | null; ip: string | null }[];
}

export interface PlatformAuditEntry extends AuditEntry {
  residence: ResidenceRef | null;
}

export interface PlatformAuditPage {
  items: PlatformAuditEntry[];
  nextCursor: string | null;
}

export interface AssistanceSession {
  accessToken: string;
  expiresAt: string;
  residence: ResidenceRef & { type: string };
}

// ---------------------------------------------------------------------
// Double authentification et notifications
// ---------------------------------------------------------------------
export interface LoginSession {
  accessToken: string;
  expiresIn: number;
  sharedDevice: boolean;
  user: User;
}

export interface MfaChallenge {
  mfa: 'required' | 'setup';
  mfaToken: string;
  expiresIn: number;
}

export interface MfaSetup {
  secret: string;
  otpauthUrl: string;
  qrSvg: string;
}

export interface MfaStatus {
  required: boolean;
  enabled: boolean;
  enabledAt: string | null;
  backupCodesRemaining: number;
}

export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

export interface PushPreferences {
  messages: boolean;
  announcements: boolean;
  priorityNotes: boolean;
  followUps: boolean;
  devices: number;
}
