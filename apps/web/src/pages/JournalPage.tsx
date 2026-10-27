// Journal de bord : toutes les notes, filtres dans l'adresse (partageables, conservés au retour).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccess } from '../lib/access';
import { useNavigate, useSearchParams } from 'react-router';
import { useCategories, useCreateNote, useNotes, useResidents, type NoteFilters } from '../api/hooks';
import { NoteCard } from '../components/NoteCard';
import { NoteForm } from '../components/NoteForm';
import { Button, Chip, Dialog, EmptyState, ErrorMessage, Loading, PageHeader, SelectField } from '../components/ui';
import { fullName } from '../lib/format';

export function JournalPage() {
  const { t } = useTranslation();
  const { can } = useAccess();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const navigate = useNavigate();
  const createNote = useCreateNote();
  const categories = useCategories();
  const residents = useResidents('all');

  const filters: NoteFilters = {
    q: params.get('q') ?? undefined,
    residentId: params.get('residentId') ?? undefined,
    categoryId: params.get('categoryId') ?? undefined,
    priority: params.get('priority') === 'true' ? true : undefined,
    unread: params.get('unread') === 'true' ? true : undefined,
    status: (params.get('status') as NoteFilters['status']) ?? undefined,
  };
  const notes = useNotes(filters);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  // Recherche : appliquée 300 ms après la dernière frappe
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((params.get('q') ?? '') !== search.trim()) setParam('q', search.trim() || null);
    }, 300);
    return () => clearTimeout(timer);
  });

  const items = notes.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = [...params.keys()].length > 0;

  return (
    <>
      <PageHeader
        title={t('journal.journal.title')}
        actions={can('journal', 'full') && <Button data-tour="journal-new" variant="primary" onClick={() => setCreating(true)}>{t('journal.journal.newNote')}</Button>}
      />

      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('journal.journal.search')}
          aria-label={t('journal.journal.searchLabel')}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base sm:text-sm"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label={t('journal.journal.resident')} value={filters.residentId ?? ''} onChange={(e) => setParam('residentId', e.target.value)}>
            <option value="">{t('journal.journal.all')}</option>
            {residents.data?.map((r) => (
              <option key={r.id} value={r.id}>{fullName(r)}{r.status === 'parti' ? t('journal.journal.left') : ''}</option>
            ))}
          </SelectField>
          <SelectField label={t('journal.journal.category')} value={filters.categoryId ?? ''} onChange={(e) => setParam('categoryId', e.target.value)}>
            <option value="">{t('journal.journal.allFeminine')}</option>
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </SelectField>
          <SelectField label={t('journal.journal.status')} value={filters.status ?? 'active'} onChange={(e) => setParam('status', e.target.value === 'active' ? null : e.target.value)}>
            <option value="active">{t('journal.journal.active')}</option>
            <option value="annulee">{t('journal.journal.cancelled')}</option>
            <option value="all">{t('journal.journal.allFeminine')}</option>
          </SelectField>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip active={!!filters.priority} onClick={() => setParam('priority', filters.priority ? null : 'true')}>{t('journal.journal.priority')}</Chip>
          <Chip active={!!filters.unread} onClick={() => setParam('unread', filters.unread ? null : 'true')}>{t('journal.journal.unread')}</Chip>
          {filtered && (
            <button type="button" className="text-sm text-primary underline" onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>
              {t('journal.journal.clear')}
            </button>
          )}
        </div>
      </div>

      {notes.isPending ? <Loading /> : notes.isError ? <ErrorMessage error={notes.error} /> : items.length === 0 ? (
        <EmptyState>{filtered ? t('journal.journal.noMatch') : t('journal.journal.empty')}</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((note) => <NoteCard key={note.id} note={note} />)}
          {notes.hasNextPage && (
            <Button className="self-center" busy={notes.isFetchingNextPage} onClick={() => notes.fetchNextPage()}>
              {t('journal.journal.more')}
            </Button>
          )}
        </div>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title={t('journal.form.newNote')}>
        <NoteForm
          defaultResidentId={filters.residentId}
          submitLabel={t('journal.form.saveNote')}
          onCancel={() => setCreating(false)}
          onSubmit={async (input) => {
            const note = await createNote.mutateAsync(input);
            setCreating(false);
            navigate(`/notes/${note.id}`);
          }}
        />
      </Dialog>
    </>
  );
}
