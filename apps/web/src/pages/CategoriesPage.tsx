// Catégories de notes (responsable) : ajouter, renommer, réordonner,
// désactiver / réactiver. Jamais supprimées : des notes y sont rattachées.
import { useState, type FormEvent } from 'react';
import { useCreateCategory, useManagedCategories, useUpdateCategory } from '../api/hooks';
import type { ManagedCategory } from '../api/types';
import { Badge, Button, EmptyState, ErrorMessage, Loading, PageHeader, TextField } from '../components/ui';

export function CategoriesPage() {
  const categories = useManagedCategories();
  const create = useCreateCategory();
  const [label, setLabel] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync({ label });
    setLabel('');
  }

  const list = categories.data ?? [];
  const active = list.filter((c) => c.isActive);
  const inactive = list.filter((c) => !c.isActive);

  return (
    <>
      <PageHeader
        title="Catégories de notes"
        subtitle="Proposées dans le formulaire de note, dans cet ordre. Une catégorie désactivée reste visible sur les anciennes notes."
      />

      <form onSubmit={submit} className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <TextField label="Nouvelle catégorie" required maxLength={60} value={label}
            onChange={(e) => setLabel(e.target.value)} placeholder="Ex. : Visite de la famille" />
        </div>
        <Button type="submit" variant="primary" busy={create.isPending}>Ajouter</Button>
      </form>
      <ErrorMessage error={create.error} />

      {categories.isPending ? <Loading /> : categories.isError ? <ErrorMessage error={categories.error} /> :
        list.length === 0 ? <EmptyState>Aucune catégorie.</EmptyState> : (
          <>
            <ul className="flex flex-col gap-2">
              {active.map((c, i) => (
                <CategoryRow key={c.id} category={c} previous={active[i - 1]} next={active[i + 1]} />
              ))}
            </ul>
            {inactive.length > 0 && (
              <>
                <h2 className="mb-2 mt-8 text-sm font-semibold text-muted">Désactivées</h2>
                <ul className="flex flex-col gap-2">
                  {inactive.map((c) => <CategoryRow key={c.id} category={c} />)}
                </ul>
              </>
            )}
          </>
        )}
    </>
  );
}

function CategoryRow({ category, previous, next }: {
  category: ManagedCategory;
  previous?: ManagedCategory;
  next?: ManagedCategory;
}) {
  const update = useUpdateCategory();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(category.label);

  // Échange de position avec la voisine (ordres égaux : on les écarte)
  function swap(other: ManagedCategory, direction: -1 | 1) {
    const mine = category.sortOrder === other.sortOrder ? other.sortOrder + direction : other.sortOrder;
    update.mutate({ id: category.id, sortOrder: Math.max(0, mine) });
    update.mutate({ id: other.id, sortOrder: category.sortOrder });
  }

  async function rename(event: FormEvent) {
    event.preventDefault();
    await update.mutateAsync({ id: category.id, label });
    setEditing(false);
  }

  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      {editing ? (
        <form onSubmit={rename} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <TextField label="Nom" required maxLength={60} autoFocus value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => { setEditing(false); setLabel(category.label); }}>Annuler</Button>
            <Button type="submit" variant="primary" busy={update.isPending}>Enregistrer</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="flex-1 font-medium">
            {category.label} {!category.isActive && <Badge>Désactivée</Badge>}
          </span>
          <div className="-ml-3 flex flex-wrap items-center gap-1 sm:ml-0">
          {category.isActive && (
            <>
              <Button variant="ghost" aria-label={`Monter ${category.label}`} disabled={!previous || update.isPending}
                onClick={() => previous && swap(previous, -1)}>↑</Button>
              <Button variant="ghost" aria-label={`Descendre ${category.label}`} disabled={!next || update.isPending}
                onClick={() => next && swap(next, 1)}>↓</Button>
              <Button variant="ghost" onClick={() => setEditing(true)}>Renommer</Button>
              <Button variant="ghost" className="text-danger" busy={update.isPending}
                onClick={() => update.mutate({ id: category.id, isActive: false })}>Désactiver</Button>
            </>
          )}
          {!category.isActive && (
            <Button busy={update.isPending} onClick={() => update.mutate({ id: category.id, isActive: true })}>Réactiver</Button>
          )}
          </div>
        </div>
      )}
      <ErrorMessage error={update.error} />
    </li>
  );
}
