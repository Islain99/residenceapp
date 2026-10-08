import { Link } from 'react-router';
import { useMarkRead } from '../api/hooks';
import type { Note } from '../api/types';
import { formatWhen, fullName } from '../lib/format';
import { cx } from '../lib/cx';
import { Badge, Button } from './ui';

export function NoteBadges({ note }: { note: Note }) {
  return (
    <>
      <Badge tone="info">{note.category.label}</Badge>
      {note.isPriority && <Badge tone="priority">Prioritaire</Badge>}
      {note.isPositive && <Badge tone="positive">Positif</Badge>}
      {note.status === 'annulee' && <Badge tone="danger">Annulée</Badge>}
      {note.versionCount > 0 && <Badge>Corrigée</Badge>}
    </>
  );
}

export function ResidentLabel({ note }: { note: Note }) {
  if (!note.resident) return <span className="text-muted">Note générale</span>;
  return (
    <Link to={`/residents/${note.resident.id}`} className="font-semibold hover:underline">
      {fullName(note.resident)}
      {note.resident.room && <span className="font-normal text-muted"> · ch. {note.resident.room}</span>}
    </Link>
  );
}

// Note dans une liste : l'essentiel, et un lien vers le détail
export function NoteCard({ note, showRead = true }: { note: Note; showRead?: boolean }) {
  const markRead = useMarkRead();
  const cancelled = note.status === 'annulee';
  return (
    <article
      className={cx(
        'rounded-xl border bg-surface p-4',
        note.isPriority && !cancelled ? 'border-priority/60 border-l-4' : 'border-line',
        cancelled && 'opacity-70',
      )}
    >
      <header className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {!note.readByMe && !cancelled && (
          <span className="size-2.5 rounded-full bg-primary" title="Non lue" aria-label="Non lue" />
        )}
        <time dateTime={note.occurredAt} className="font-medium tabular-nums">{formatWhen(note.occurredAt)}</time>
        <ResidentLabel note={note} />
        <div className="flex flex-wrap gap-1.5"><NoteBadges note={note} /></div>
      </header>

      <Link to={`/notes/${note.id}`} className="block rounded-md hover:bg-sunken/60">
        <p className={cx('line-clamp-4 whitespace-pre-line', cancelled && 'line-through')}>{note.description}</p>
        {note.intervention && (
          <p className="mt-1.5 line-clamp-2 whitespace-pre-line text-sm text-muted">
            <span className="font-medium">Intervention : </span>{note.intervention}
          </p>
        )}
      </Link>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>{fullName(note.author)}</span>
        {showRead && !note.readByMe && !cancelled && (
          <Button variant="ghost" className="min-h-9 px-3 text-xs" busy={markRead.isPending} onClick={() => markRead.mutate(note.id)}>
            Marquer comme lue
          </Button>
        )}
      </footer>
    </article>
  );
}
