// Accès aux données : une fonction par lecture ou écriture de l'API.
// Après une écriture, les listes concernées sont relues (invalidate).
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  Account, AccountInput, Category, FollowUp, Handover, Note, NoteDetail, NoteInput, NotePage, Resident,
  ResidentInput, ResidentSummary, StaffMember,
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
    onSuccess: () => invalidate('handover'),
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

export const forgotPassword = (email: string) =>
  api<void>('/auth/password/forgot', { method: 'POST', body: { email } });

export const checkPasswordToken = (token: string) =>
  api<{ purpose: 'invite' | 'reset'; email: string; firstName: string }>('/auth/password/check', { method: 'POST', body: { token } });

export const setPassword = (token: string, password: string) =>
  api<void>('/auth/password/reset', { method: 'POST', body: { token, password } });
