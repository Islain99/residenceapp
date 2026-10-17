// Accès aux données : une fonction par lecture ou écriture de l'API.
// Après une écriture, les listes concernées sont relues (invalidate).
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/session';
import { api } from './client';
import type {
  AdminConversation, AnnouncementAcks, ConsultedMessage, Conversation, Message, MessagePage, MessagingSummary,
  Account, AccountInput, Appointment, AppointmentInput, AppointmentKind, AuditPage, Category, ResidentStats, Shift, ShiftType, StatsPeriod, FollowUp, Handover, ManagedCategory, Note, NoteDetail, NoteInput,
  NotePage, Resident, ResidentInput, ResidentSummary, StaffMember,
  AssistanceGrant, NewResidenceInput, OpenAssistanceGrant, PlatformAccount, PlatformAuditPage, PlatformResidence,
  PlatformResidenceDetail, PlatformSecurity, MfaStatus, PushConfig, PushPreferences,
  ProfileInput, User,
} from './types';

export interface NoteFilters {
  residentId?: string;
  categoryId?: string;
  q?: string;
  priority?: boolean;
  unread?: boolean;
  status?: 'active' | 'annulee' | 'all';
}

export type FollowUpFilter = { status: 'open' | 'closed' | 'all'; assignedTo?: 'me' | 'team'; residentId?: string };

// ---------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------
export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/note-categories'), staleTime: 10 * 60_000 });

// Toutes les catégories, désactivées comprises (responsable)
export const useManagedCategories = () =>
  useQuery({ queryKey: ['categories', 'all'], queryFn: () => api<ManagedCategory[]>('/note-categories', { query: { all: true } }) });

export interface AuditFilters {
  action?: string;
  entity?: string;
  userId?: string;
  from?: string;
  to?: string;
}

export const useAudit = (filters: AuditFilters) =>
  useInfiniteQuery({
    queryKey: ['audit', filters],
    queryFn: ({ pageParam }) => api<AuditPage>('/audit', { query: { ...filters, limit: 50, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useStaff = () =>
  useQuery({ queryKey: ['staff'], queryFn: () => api<StaffMember[]>('/staff'), staleTime: 10 * 60_000 });

export const useResidents = (status: 'actif' | 'parti' | 'all' = 'actif', q = '') =>
  useQuery({
    queryKey: ['residents', status, q],
    queryFn: () => api<ResidentSummary[]>('/residents', { query: { status, q } }),
  });

export const useResident = (id: string) =>
  useQuery({ queryKey: ['resident', id], queryFn: () => api<Resident>(`/residents/${id}`) });

export const useNotes = (filters: NoteFilters, limit = 30) =>
  useInfiniteQuery({
    queryKey: ['notes', filters, limit],
    queryFn: ({ pageParam }) => api<NotePage>('/notes', { query: { ...filters, limit, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useNote = (id: string) =>
  useQuery({ queryKey: ['note', id], queryFn: () => api<NoteDetail>(`/notes/${id}`) });

export const useFollowUps = (filter: FollowUpFilter) =>
  useQuery({ queryKey: ['follow-ups', filter], queryFn: () => api<FollowUp[]>('/follow-ups', { query: filter }) });

export const useHandover = () =>
  useQuery({ queryKey: ['handover'], queryFn: () => api<Handover>('/handover'), refetchInterval: 60_000 });

// ---------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------
function useInvalidate() {
  const client = useQueryClient();
  return (...keys: string[]) => Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: [key] })));
}

const JOURNAL = ['notes', 'note', 'handover', 'follow-ups'];

export function useCreateNote() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: NoteInput) => api<Note>('/notes', { method: 'POST', body: input }),
    onSuccess: () => invalidate(...JOURNAL),
  });
}

export function useUpdateNote(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: Partial<NoteInput>) => api<Note>(`/notes/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidate(...JOURNAL),
  });
}

export function useCancelNote(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (reason: string) => api<Note>(`/notes/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => invalidate(...JOURNAL),
  });
}

export function useMarkRead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/notes/${id}/read`, { method: 'POST' }),
    onSuccess: () => invalidate('notes', 'note', 'handover'),
  });
}

export function useAcknowledgeHandover() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (seenUntil: string) => api<{ acknowledgedAt: string }>('/handover/ack', { method: 'POST', body: { seenUntil } }),
    // La relève confirme la lecture des notes ordinaires : les listes changent aussi
    onSuccess: () => invalidate('handover', 'notes', 'note'),
  });
}

export interface FollowUpInput { description: string; assignedTo: string | null; dueAt: string | null }

export function useCreateFollowUp(noteId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: FollowUpInput) => api<FollowUp>(`/notes/${noteId}/follow-ups`, { method: 'POST', body: input }),
    onSuccess: () => invalidate('note', 'follow-ups', 'handover'),
  });
}

// « Je m'en occupe » : s'assigner un suivi ouvert
export function useTakeFollowUp() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) =>
      api<FollowUp>(`/follow-ups/${id}`, { method: 'PATCH', body: { assignedTo: userId } }),
    onSuccess: () => invalidate('note', 'follow-ups', 'handover'),
  });
}

export function useCloseFollowUp() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, closingNote }: { id: string; closingNote: string | null }) =>
      api<FollowUp>(`/follow-ups/${id}/close`, { method: 'POST', body: { closingNote } }),
    onSuccess: () => invalidate('note', 'follow-ups', 'handover'),
  });
}

export function useSaveResident(id?: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: Partial<ResidentInput> & { status?: 'actif' | 'parti'; leftAt?: string | null }) =>
      id
        ? api<Resident>(`/residents/${id}`, { method: 'PATCH', body: input })
        : api<Resident>('/residents', { method: 'POST', body: input }),
    onSuccess: () => invalidate('residents', 'resident', 'notes'),
  });
}

// ---------------------------------------------------------------------
// Comptes des employés (responsable) et mot de passe
// ---------------------------------------------------------------------
export const useAccounts = () =>
  useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/users') });

export function useInviteAccount() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: AccountInput) => api<Account>('/users', { method: 'POST', body: input }),
    onSuccess: () => invalidate('accounts', 'staff'),
  });
}

export function useResendInvite() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<Account>(`/users/${id}/invite`, { method: 'POST', body: {} }),
    onSuccess: () => invalidate('accounts'),
  });
}

export function useUpdateAccount() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Partial<Omit<AccountInput, 'email'>> & { isActive?: boolean }) =>
      api<Account>(`/users/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidate('accounts', 'staff'),
  });
}

export function useCreateCategory() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { label: string }) => api<ManagedCategory>('/note-categories', { method: 'POST', body: input }),
    onSuccess: () => invalidate('categories', 'audit'),
  });
}

export function useUpdateCategory() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; label?: string; sortOrder?: number; isActive?: boolean }) =>
      api<ManagedCategory>(`/note-categories/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidate('categories', 'audit'),
  });
}

// Export complet du dossier d'un résident (Loi 25), téléchargé en JSON
export async function downloadResidentExport(resident: { id: string; firstName: string; lastName: string }) {
  const data = await api<unknown>(`/residents/${resident.id}/export`);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const name = `dossier-${resident.lastName}-${resident.firstName}-${new Date().toISOString().slice(0, 10)}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '-').toLowerCase();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export const forgotPassword = (email: string) =>
  api<void>('/auth/password/forgot', { method: 'POST', body: { email } });

export const checkPasswordToken = (token: string) =>
  api<{ purpose: 'invite' | 'reset'; email: string; firstName: string }>('/auth/password/check', { method: 'POST', body: { token } });

export const setPassword = (token: string, password: string) =>
  api<void>('/auth/password/reset', { method: 'POST', body: { token, password } });

// ---------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------
export interface AppointmentFilters {
  from: string;
  to: string;
  residentId?: string;
  kind?: AppointmentKind;
  status?: 'prevu' | 'annule' | 'all';
}

export const useAppointments = (filters: AppointmentFilters) =>
  useQuery({ queryKey: ['appointments', filters], queryFn: () => api<Appointment[]>('/appointments', { query: { ...filters } }) });

export function useSaveAppointment(id?: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: Partial<AppointmentInput>) =>
      id
        ? api<Appointment>(`/appointments/${id}`, { method: 'PATCH', body: input })
        : api<Appointment>('/appointments', { method: 'POST', body: input }),
    onSuccess: () => invalidate('appointments', 'handover'),
  });
}

export function useCancelAppointment(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (reason: string) => api<Appointment>(`/appointments/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => invalidate('appointments', 'handover'),
  });
}

// ---------------------------------------------------------------------
// Horaires
// ---------------------------------------------------------------------
export const useShiftTypes = (all = false) =>
  useQuery({ queryKey: ['shift-types', all], queryFn: () => api<ShiftType[]>('/shift-types', { query: { all } }), staleTime: 5 * 60_000 });

export function useSaveShiftType(id?: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: Partial<Omit<ShiftType, 'id'>>) =>
      id
        ? api<ShiftType>(`/shift-types/${id}`, { method: 'PATCH', body: input })
        : api<ShiftType>('/shift-types', { method: 'POST', body: input }),
    onSuccess: () => invalidate('shift-types'),
  });
}

export const useShifts = (from: string, to: string, userId?: string) =>
  useQuery({ queryKey: ['shifts', from, to, userId], queryFn: () => api<Shift[]>('/shifts', { query: { from, to, userId } }) });

export interface ShiftInput {
  userId: string;
  workDate: string;
  shiftTypeId: string;
  startTime?: string;
  endTime?: string;
  notes?: string | null;
}

export function useSaveShift(id?: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: Partial<ShiftInput>) =>
      id
        ? api<Shift>(`/shifts/${id}`, { method: 'PATCH', body: input })
        : api<Shift>('/shifts', { method: 'POST', body: input }),
    onSuccess: () => invalidate('shifts'),
  });
}

export function useCancelShift() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/shifts/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: () => invalidate('shifts'),
  });
}

export function useCopyWeek() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { fromWeek: string; toWeek: string }) =>
      api<{ created: number; skipped: number }>('/shifts/copy-week', { method: 'POST', body: input }),
    onSuccess: () => invalidate('shifts'),
  });
}

// ---------------------------------------------------------------------
// Statistiques d'un résident (infirmière, responsable)
// ---------------------------------------------------------------------
export const useResidentStats = (id: string, period: StatsPeriod, date?: string) =>
  useQuery({
    queryKey: ['resident-stats', id, period, date],
    queryFn: () => api<ResidentStats>(`/residents/${id}/stats`, { query: { period, date } }),
    placeholderData: (previous) => previous,   // garde le graphique affiché pendant le changement de période
  });

// ---------------------------------------------------------------------
// Messagerie. Quasi en direct : la liste et les non-lus sont relus toutes les
// 15 s, le fil ouvert toutes les 5 s (et au retour sur l'onglet).
// ---------------------------------------------------------------------
const LIST_REFRESH_MS = 15_000;
const THREAD_REFRESH_MS = 5_000;

export const useConversations = () =>
  useQuery({ queryKey: ['conversations'], queryFn: () => api<Conversation[]>('/conversations'), refetchInterval: LIST_REFRESH_MS });

// Pas en accès d'assistance : la messagerie reste privée
export function useMessagingSummary() {
  const { assistance } = useAuth();
  return useQuery({
    queryKey: ['messaging-summary'],
    queryFn: () => api<MessagingSummary>('/messaging/summary'),
    refetchInterval: LIST_REFRESH_MS,
    enabled: !assistance,
  });
}

export const useConversation = (id: string) =>
  useQuery({ queryKey: ['conversation', id], queryFn: () => api<Conversation>(`/conversations/${id}`) });

export const useMessages = (conversationId: string) =>
  useInfiniteQuery({
    queryKey: ['messages', conversationId],
    queryFn: ({ pageParam }) => api<MessagePage>(`/conversations/${conversationId}/messages`, { query: { limit: 50, before: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: THREAD_REFRESH_MS,
  });

const MESSAGING = ['conversations', 'messaging-summary', 'conversation', 'messages'];

export function useSendMessage(conversationId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: string) => api<Message>(`/conversations/${conversationId}/messages`, { method: 'POST', body: { body } }),
    onSuccess: () => invalidate(...MESSAGING),
  });
}

export function useEditMessage() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api<Message>(`/messages/${id}`, { method: 'PATCH', body: { body } }),
    onSuccess: () => invalidate(...MESSAGING),
  });
}

export function useRetractMessage() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<Message>(`/messages/${id}/retract`, { method: 'POST' }),
    onSuccess: () => invalidate(...MESSAGING),
  });
}

export function useMarkConversationRead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/conversations/${id}/read`, { method: 'POST' }),
    onSuccess: () => invalidate('conversations', 'messaging-summary'),
  });
}

export function useAckAnnouncement() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/messages/${id}/ack`, { method: 'POST' }),
    onSuccess: () => invalidate(...MESSAGING, 'acks'),
  });
}

export const useAnnouncementAcks = (messageId: string | null) =>
  useQuery({
    queryKey: ['acks', messageId],
    queryFn: () => api<AnnouncementAcks>(`/messages/${messageId}/acks`),
    enabled: messageId !== null,
  });

export type NewConversation =
  | { kind: 'direct'; userId: string }
  | { kind: 'group'; title: string; memberIds: string[] };

export function useCreateConversation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: NewConversation) => api<Conversation>('/conversations', { method: 'POST', body: input }),
    onSuccess: () => invalidate('conversations'),
  });
}

export function useAddMembers(conversationId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (userIds: string[]) => api<Conversation>(`/conversations/${conversationId}/members`, { method: 'POST', body: { userIds } }),
    onSuccess: () => invalidate('conversations', 'conversation'),
  });
}

export function useRenameGroup(conversationId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (title: string) => api<Conversation>(`/conversations/${conversationId}`, { method: 'PATCH', body: { title } }),
    onSuccess: () => invalidate('conversations', 'conversation'),
  });
}

export function useLeaveGroup() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (conversationId: string) => api<void>(`/conversations/${conversationId}/leave`, { method: 'POST' }),
    onSuccess: () => invalidate('conversations', 'messaging-summary'),
  });
}

// Responsable : conversations privées et de groupe (sans contenu), consultation tracée
export const useAdminConversations = () =>
  useQuery({ queryKey: ['admin-conversations'], queryFn: () => api<AdminConversation[]>('/admin/conversations') });

export function useConsultConversation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api<{ messages: ConsultedMessage[] }>(`/admin/conversations/${id}/consult`, { method: 'POST', body: { reason } }),
    onSuccess: () => invalidate('audit'),
  });
}

// ---------------------------------------------------------------------
// Accès d'assistance (responsable)
// ---------------------------------------------------------------------
export const useAssistanceGrants = () =>
  useQuery({ queryKey: ['assistance'], queryFn: () => api<AssistanceGrant[]>('/assistance'), refetchInterval: 30_000 });

export function useGrantAssistance() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { hours: number; reason?: string }) => api<AssistanceGrant>('/assistance', { method: 'POST', body: input }),
    onSuccess: () => invalidate('assistance', 'audit'),
  });
}

export function useRevokeAssistance() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<AssistanceGrant>(`/assistance/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => invalidate('assistance', 'audit'),
  });
}

// ---------------------------------------------------------------------
// Administration de la plateforme (admin)
// ---------------------------------------------------------------------
export const usePlatformResidences = () =>
  useQuery({ queryKey: ['platform', 'residences'], queryFn: () => api<PlatformResidence[]>('/platform/residences') });

export const usePlatformResidence = (id: string) =>
  useQuery({ queryKey: ['platform', 'residence', id], queryFn: () => api<PlatformResidenceDetail>(`/platform/residences/${id}`) });

export const useOpenAssistance = () =>
  useQuery({ queryKey: ['platform', 'assistance'], queryFn: () => api<OpenAssistanceGrant[]>('/platform/assistance'), refetchInterval: 30_000 });

export const usePlatformSecurity = () =>
  useQuery({ queryKey: ['platform', 'security'], queryFn: () => api<PlatformSecurity>('/platform/security'), refetchInterval: 60_000 });

export const usePlatformAdmins = () =>
  useQuery({ queryKey: ['platform', 'admins'], queryFn: () => api<PlatformAccount[]>('/platform/admins') });

export const usePlatformAudit = (filters: { residenceId?: string; action?: string }) =>
  useInfiniteQuery({
    queryKey: ['platform', 'audit', filters],
    queryFn: ({ pageParam }) => api<PlatformAuditPage>('/platform/audit', { query: { ...filters, limit: 50, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

// Toute écriture de la plateforme relit ses écrans
function usePlatformMutation<I, O>(fn: (input: I) => Promise<O>) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidate('platform') });
}

export const useCreateResidence = () =>
  usePlatformMutation((input: NewResidenceInput) => api<PlatformResidence>('/platform/residences', { method: 'POST', body: input }));

export const useUpdateResidence = () =>
  usePlatformMutation(({ id, ...body }: { id: string; name?: string; type?: 'RPA' | 'RI'; timezone?: string; isActive?: boolean; reason?: string }) =>
    api<PlatformResidence>(`/platform/residences/${id}`, { method: 'PATCH', body }));

export const useAddResponsable = () =>
  usePlatformMutation(({ residenceId, ...body }: { residenceId: string } & ({ userId: string } | { email: string; firstName: string; lastName: string })) =>
    api<PlatformAccount>(`/platform/residences/${residenceId}/responsables`, { method: 'POST', body }));

export type PlatformAccountAction = 'invite' | 'reset-password' | 'unlock' | 'revoke-sessions' | 'reset-mfa';

export const usePlatformAccountAction = () =>
  usePlatformMutation(({ id, action }: { id: string; action: PlatformAccountAction }) =>
    api<unknown>(`/platform/users/${id}/${action}`, { method: 'POST' }));

export const useSetPlatformAccountActive = () =>
  usePlatformMutation(({ id, isActive }: { id: string; isActive: boolean }) =>
    api<PlatformAccount>(`/platform/users/${id}`, { method: 'PATCH', body: { isActive } }));

export const useInviteAdmin = () =>
  usePlatformMutation((input: { email: string; firstName: string; lastName: string }) =>
    api<PlatformAccount>('/platform/admins', { method: 'POST', body: input }));

export const useEndAssistance = () =>
  usePlatformMutation((id: string) => api<void>(`/platform/assistance/${id}/end`, { method: 'POST' }));

// ---------------------------------------------------------------------
// Mon compte : double authentification, notifications
// ---------------------------------------------------------------------
export const useMfaStatus = () =>
  useQuery({ queryKey: ['mfa'], queryFn: () => api<MfaStatus>('/auth/mfa') });

export function useRegenerateBackupCodes() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (code: string) => api<{ backupCodes: string[] }>('/auth/mfa/backup-codes', { method: 'POST', body: { code } }),
    onSuccess: () => invalidate('mfa'),
  });
}

// ---------------------------------------------------------------------
// Mon profil
// ---------------------------------------------------------------------
export function useUpdateProfile() {
  const { updateUser } = useAuth();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: ProfileInput) => api<User>('/auth/me', { method: 'PATCH', body: input }),
    onSuccess: (user) => {
      updateUser(user);
      void invalidate('accounts', 'staff');   // nom et couleur dans l'équipe
    },
  });
}

export const useChangePassword = () =>
  useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string; signOutOthers: boolean }) =>
      api<{ otherSessionsClosed: number }>('/auth/password/change', { method: 'POST', body: input }),
  });

export const usePushConfig = () =>
  useQuery({ queryKey: ['push', 'config'], queryFn: () => api<PushConfig>('/push/config'), staleTime: Infinity });

export const usePushPreferences = () =>
  useQuery({ queryKey: ['push', 'preferences'], queryFn: () => api<PushPreferences>('/push/preferences') });

export function useUpdatePushPreferences() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (changes: Partial<Omit<PushPreferences, 'devices'>>) =>
      api<PushPreferences>('/push/preferences', { method: 'PATCH', body: changes }),
    onSuccess: () => invalidate('push'),
  });
}

export const useSendTestPush = () =>
  useMutation({ mutationFn: () => api<{ sent: number }>('/push/test', { method: 'POST' }) });

// Envoi des courriels (admin plateforme)
export const usePlatformEmail = () =>
  useQuery({ queryKey: ['platform', 'email'], queryFn: () => api<{ provider: string; from: string }>('/platform/email') });

export const useSendTestEmail = () =>
  useMutation({
    mutationFn: (to?: string) => api<{ to: string; provider: string }>('/platform/email/test', { method: 'POST', body: to ? { to } : {} }),
  });
