import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMarkRead } from '../api/hooks';
import type { Note } from '../api/types';
import { formatWhen, fullName } from '../lib/format';
import { cx } from '../lib/cx';
import { Badge, Button } from './ui';

export function NoteBadges({ note }: { note: Note }) {
  const { t } = useTranslation();
  return (
    <>
      <Badge tone="info">{note.category.label}</Badge>
      {note.isPriority && <Badge tone="priority">{t('journal.note.priority')}</Badge>}
      {note.isPositive && <Badge tone="positive">{t('journal.note.positive')}</Badge>}
      {note.status === 'annulee' && <Badge tone="danger">{t('journal.note.cancelled')}</Badge>}
      {note.isPriority && !note.readByMe && note.contentEditedAt && note.status === 'active'
        ? <Badge tone="priority">{t('journal.note.editedReread')}</Badge>
        : note.modifiedSinceRead ? <Badge tone="info">{t('journal.note.modifiedSinceRead')}</Badge>
          : note.versionCount > 0 && <Badge>{t('journal.note.edited')}</Badge>}
    </>
  );
}

export function ResidentLabel({ note }: { note: Note }) {
  const { t } = useTranslation();
  if (!note.resident) return <span className="text-muted">{t('journal.note.general')}</span>;
  return (
    <Link to={`/residents/${note.resident.id}`} className="font-semibold hover:underline">
      {fullName(note.resident)}
      {note.resident.room && <span className="font-normal text-muted"> · {t('journal.note.room', { room: note.resident.room })}</span>}
    </Link>
  );
}

// Note dans une liste : l'essentiel, et un lien vers le détail
export function NoteCard({ note, showRead = true }: { note: Note; showRead?: boolean }) {
  const { t } = useTranslation();
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
          <span className="size-2.5 rounded-full bg-primary" title={t('journal.note.unread')} aria-label={t('journal.note.unread')} />
        )}
        <time dateTime={note.occurredAt} className="font-medium tabular-nums">{formatWhen(note.occurredAt)}</time>
        <ResidentLabel note={note} />
        <div className="flex flex-wrap gap-1.5"><NoteBadges note={note} /></div>
      </header>

      <Link to={`/notes/${note.id}`} className="block rounded-md hover:bg-sunken/60">
        <p className={cx('line-clamp-4 whitespace-pre-line', cancelled && 'line-through')}>{note.description}</p>
        {note.intervention && (
          <p className="mt-1.5 line-clamp-2 whitespace-pre-line text-sm text-muted">
            <span className="font-medium">{t('journal.note.interventionLabel')}</span>{note.intervention}
          </p>
        )}
      </Link>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>{fullName(note.author)}</span>
        {showRead && !note.readByMe && !cancelled && (note.isPriority ? (
          // Consigne prioritaire : à confirmer une à une (la relève ne le fait pas)
          <Button variant="primary" className="min-h-9 px-3 text-xs" busy={markRead.isPending} onClick={() => markRead.mutate(note.id)}>
            {t('journal.note.readPriority')}
          </Button>
        ) : (
          <Button variant="ghost" className="min-h-9 px-3 text-xs" busy={markRead.isPending} onClick={() => markRead.mutate(note.id)}>
            {t('journal.note.markRead')}
          </Button>
        ))}
      </footer>
    </article>
  );
}
