// Journal de bord : toutes les notes, filtres dans l'adresse (partageables, conservés au retour).
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useCategories, useCreateNote, useNotes, useResidents, type NoteFilters } from '../api/hooks';
import { NoteCard } from '../components/NoteCard';
import { NoteForm } from '../components/NoteForm';
import { Button, Chip, Dialog, EmptyState, ErrorMessage, Loading, PageHeader, SelectField } from '../components/ui';
import { fullName } from '../lib/format';

export function JournalPage() {
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
        title="Journal de bord"
        actions={<Button variant="primary" onClick={() => setCreating(true)}>+ Nouvelle note</Button>}
      />

      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher dans les notes (ex. : chute, désorientée)…"
          aria-label="Rechercher dans les notes"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base sm:text-sm"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label="Résident" value={filters.residentId ?? ''} onChange={(e) => setParam('residentId', e.target.value)}>
            <option value="">Tous</option>
            {residents.data?.map((r) => (
              <option key={r.id} value={r.id}>{fullName(r)}{r.status === 'parti' ? ' (parti)' : ''}</option>
            ))}
          </SelectField>
          <SelectField label="Catégorie" value={filters.categoryId ?? ''} onChange={(e) => setParam('categoryId', e.target.value)}>
            <option value="">Toutes</option>
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </SelectField>
          <SelectField label="Statut" value={filters.status ?? 'active'} onChange={(e) => setParam('status', e.target.value === 'active' ? null : e.target.value)}>
            <option value="active">Actives</option>
            <option value="annulee">Annulées</option>
            <option value="all">Toutes</option>
          </SelectField>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip active={!!filters.priority} onClick={() => setParam('priority', filters.priority ? null : 'true')}>Prioritaires</Chip>
          <Chip active={!!filters.unread} onClick={() => setParam('unread', filters.unread ? null : 'true')}>Non lues</Chip>
          {filtered && (
            <button type="button" className="text-sm text-primary underline" onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>
              Effacer les filtres
            </button>
          )}
        </div>
      </div>

      {notes.isPending ? <Loading /> : notes.isError ? <ErrorMessage error={notes.error} /> : items.length === 0 ? (
        <EmptyState>{filtered ? 'Aucune note ne correspond à ces filtres.' : 'Aucune note pour le moment.'}</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((note) => <NoteCard key={note.id} note={note} />)}
          {notes.hasNextPage && (
            <Button className="self-center" busy={notes.isFetchingNextPage} onClick={() => notes.fetchNextPage()}>
              Afficher plus
            </Button>
          )}
        </div>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title="Nouvelle note">
        <NoteForm
          defaultResidentId={filters.residentId}
          submitLabel="Enregistrer la note"
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
