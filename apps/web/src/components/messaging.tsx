// Messagerie : éléments partagés (liste, fil, saisie, nouvelle conversation,
// confirmations d'annonces).
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  useAckAnnouncement, useAddMembers, useAnnouncementAcks, useCreateConversation, useEditMessage, useLeaveGroup,
  useMarkConversationRead, useMessages, useRenameGroup, useRetractMessage, useSendMessage, useStaff,
} from '../api/hooks';
import type { Conversation, Message, Person } from '../api/types';
import { useUser } from '../auth/session';
import { cx } from '../lib/cx';
import { formatTime, formatWhen, fullName } from '../lib/format';
import { Badge, Button, Checkbox, Dialog, EmptyState, ErrorMessage, Loading, TextField } from './ui';

const day = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });

const initials = (p: Pick<Person, 'firstName' | 'lastName'>) =>
  `${p.firstName.charAt(0)}${p.lastName.charAt(0)}`.toUpperCase();

// Pastille : initiales pour une personne, symbole pour un canal ou un groupe
export function ConversationAvatar({ conversation }: { conversation: Conversation }) {
  const me = useUser();
  const other = conversation.members.find((m) => m.id !== me.id);
  const symbol = conversation.kind === 'announcements' ? '📣' : conversation.kind === 'team' ? '★'
    : conversation.kind === 'group' ? '👥' : other ? initials(other) : '?';
  return (
    <span
      aria-hidden
      className={cx(
        'flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
        conversation.kind === 'announcements' ? 'bg-priority-soft text-priority'
          : conversation.kind === 'direct' ? 'bg-info-soft text-primary' : 'bg-sunken text-ink',
      )}
    >
      {symbol}
    </span>
  );
}

// ---------------------------------------------------------------------
// Liste des conversations
// ---------------------------------------------------------------------
export function ConversationListItem({ conversation, active }: { conversation: Conversation; active: boolean }) {
  const me = useUser();
  const last = conversation.lastMessage;
  const unread = conversation.unreadCount > 0;
  const preview = !last ? 'Aucun message'
    : last.excerpt === null ? 'Message retiré'
      : `${last.author.id === me.id ? 'Vous' : last.author.firstName} : ${last.excerpt}`;
  return (
    <li>
      <Link
        to={`/messages/${conversation.id}`}
        aria-current={active ? 'page' : undefined}
        className={cx(
          'flex items-center gap-3 rounded-xl px-3 py-3',
          active ? 'bg-info-soft' : 'hover:bg-sunken',
        )}
      >
        <ConversationAvatar conversation={conversation} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cx('truncate', unread ? 'font-bold' : 'font-medium')}>{conversation.title}</span>
            {last && <time dateTime={last.createdAt} className="shrink-0 text-xs text-muted">{formatWhen(last.createdAt)}</time>}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className={cx('truncate text-sm', unread ? 'text-ink' : 'text-muted', last?.excerpt === null && 'italic')}>{preview}</span>
            {conversation.pendingAcks > 0 ? (
              <span className="shrink-0 rounded-full bg-priority px-2 text-xs font-bold text-white" title="Annonces à confirmer">
                {conversation.pendingAcks}
              </span>
            ) : unread && (
              <span className="shrink-0 rounded-full bg-primary px-2 text-xs font-bold text-on-primary" aria-label={`${conversation.unreadCount} non lus`}>
                {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------
// Fil de messages
// ---------------------------------------------------------------------
export function Thread({ conversation }: { conversation: Conversation }) {
  const me = useUser();
  const messages = useMessages(conversation.id);
  const { mutate: markConversationRead } = useMarkConversationRead();
  const [editing, setEditing] = useState<Message | null>(null);
  const [acksFor, setAcksFor] = useState<Message | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Pages de l'API : la première est la plus récente
  const items = (messages.data?.pages ?? []).slice().reverse().flatMap((p) => p.items);
  const newest = items.at(-1);

  // Conversation ouverte : lue jusqu'au dernier message
  const unread = conversation.unreadCount;
  const newestId = newest?.id;
  useEffect(() => {
    if (newestId && unread > 0) markConversationRead(conversation.id);
  }, [conversation.id, newestId, unread, markConversationRead]);

  // Nouveau message : rester en bas si on y était déjà
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [newestId, items.length]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  if (messages.isPending) return <Loading />;
  if (messages.isError) return <ErrorMessage error={messages.error} />;

  const announcements = conversation.kind === 'announcements';
  // Séparateur de jour, et messages rapprochés du même auteur regroupés
  const rows = items.map((m, i) => {
    const previous = items[i - 1];
    const d = day.format(new Date(m.createdAt));
    const showDay = !previous || day.format(new Date(previous.createdAt)) !== d;
    const grouped = !showDay && previous?.author.id === m.author.id
      && new Date(m.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;
    return { m, d, showDay, grouped };
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-1 py-3" aria-live="polite">
        {messages.hasNextPage && (
          <div className="mb-3 flex justify-center">
            <Button className="min-h-9 text-xs" busy={messages.isFetchingNextPage}
              onClick={() => { stickToBottom.current = false; void messages.fetchNextPage(); }}>
              Messages plus anciens
            </Button>
          </div>
        )}
        {items.length === 0 && (
          <EmptyState>{announcements ? 'Aucune annonce pour le moment.' : 'Aucun message. Écrivez le premier !'}</EmptyState>
        )}
        <ol className="flex flex-col gap-2">
          {rows.map(({ m, d, showDay, grouped }) => {
            return (
              <li key={m.id}>
                {showDay && (
                  <p className="my-3 text-center text-xs font-medium text-muted first-letter:uppercase">{d}</p>
                )}
                {announcements
                  ? <AnnouncementItem message={m} canSeeAcks={conversation.canPost} onShowAcks={() => setAcksFor(m)} onEdit={setEditing} />
                  : <Bubble message={m} showAuthor={!m.mine && conversation.kind !== 'direct' && !grouped} onEdit={setEditing} />}
              </li>
            );
          })}
        </ol>
      </div>

      {conversation.canPost ? (
        <Composer
          key={editing?.id ?? 'new'}
          conversation={conversation}
          editing={editing}
          onDone={() => { setEditing(null); stickToBottom.current = true; }}
        />
      ) : (
        <p className="border-t border-line px-3 py-3 text-center text-sm text-muted">
          {conversation.kind === 'announcements'
            ? "Seules l'infirmière et la responsable publient des annonces."
            : "Ce collègue n'a plus de compte actif : la conversation est en lecture seule."}
        </p>
      )}

      <AcksDialog message={acksFor} onClose={() => setAcksFor(null)} me={me.id} />
    </div>
  );
}

// Actions de l'auteur pendant 15 minutes
function OwnActions({ message, onEdit }: { message: Message; onEdit: (m: Message) => void }) {
  const retract = useRetractMessage();
  const [now] = useState(() => Date.now());
  if (!message.editableUntil || new Date(message.editableUntil).getTime() < now) return null;
  return (
    <span className="flex gap-2">
      <button type="button" className="text-xs text-muted underline hover:text-ink" onClick={() => onEdit(message)}>Modifier</button>
      <button
        type="button"
        className="text-xs text-muted underline hover:text-danger"
        disabled={retract.isPending}
        onClick={() => {
          if (window.confirm('Retirer ce message ? Il ne sera plus affiché, mais il reste conservé.')) retract.mutate(message.id);
        }}
      >
        Retirer
      </button>
    </span>
  );
}

function Bubble({ message, showAuthor, onEdit }: { message: Message; showAuthor: boolean; onEdit: (m: Message) => void }) {
  const retracted = message.body === null;
  return (
    <div className={cx('flex flex-col', message.mine ? 'items-end' : 'items-start')}>
      {showAuthor && <span className="mb-0.5 px-1 text-xs font-medium text-muted">{fullName(message.author)}</span>}
      <div
        className={cx(
          'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 sm:max-w-[70%]',
          retracted ? 'border border-dashed border-line italic text-muted'
            : message.mine ? 'rounded-br-md bg-primary text-on-primary' : 'rounded-bl-md bg-sunken text-ink',
        )}
      >
        {retracted ? 'Message retiré' : message.body}
      </div>
      <span className="mt-0.5 flex items-center gap-2 px-1 text-[11px] text-muted">
        <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
        {message.editedAt && !retracted && <span>· modifié</span>}
        {message.mine && <OwnActions message={message} onEdit={onEdit} />}
      </span>
    </div>
  );
}

function AnnouncementItem({ message, canSeeAcks, onShowAcks, onEdit }: {
  message: Message; canSeeAcks: boolean; onShowAcks: () => void; onEdit: (m: Message) => void;
}) {
  const ack = useAckAnnouncement();
  const retracted = message.body === null;
  return (
    <article className={cx('rounded-xl border bg-surface p-4', !message.ack?.ackedByMe && !retracted ? 'border-l-4 border-priority/60' : 'border-line')}>
      <header className="mb-1 flex flex-wrap items-center gap-x-3 text-sm">
        <span className="font-semibold">{fullName(message.author)}</span>
        <time dateTime={message.createdAt} className="text-muted">{formatWhen(message.createdAt)}</time>
        {message.editedAt && !retracted && <span className="text-xs text-muted">modifiée</span>}
      </header>
      <p className={cx('whitespace-pre-wrap break-words', retracted && 'italic text-muted')}>{retracted ? 'Annonce retirée' : message.body}</p>
      {!retracted && (
        <footer className="mt-3 flex flex-wrap items-center gap-3">
          {message.mine ? (
            canSeeAcks && (
              <button type="button" className="text-sm text-primary hover:underline" onClick={onShowAcks}>
                Lue par {message.ack?.count ?? 0} — voir qui manque
              </button>
            )
          ) : message.ack?.ackedByMe ? (
            <Badge tone="positive">Lecture confirmée</Badge>
          ) : (
            <Button variant="primary" className="min-h-9" busy={ack.isPending} onClick={() => ack.mutate(message.id)}>
              J'ai lu cette annonce
            </Button>
          )}
          {!message.mine && canSeeAcks && (
            <button type="button" className="text-sm text-muted hover:underline" onClick={onShowAcks}>
              Lue par {message.ack?.count ?? 0}
            </button>
          )}
          {message.mine && <OwnActions message={message} onEdit={onEdit} />}
        </footer>
      )}
      <ErrorMessage error={ack.error} />
    </article>
  );
}

function AcksDialog({ message, onClose, me }: { message: Message | null; onClose: () => void; me: string }) {
  const acks = useAnnouncementAcks(message?.id ?? null);
  return (
    <Dialog open={message !== null} onClose={onClose} title="Confirmations de lecture">
      {acks.isPending ? <Loading /> : acks.isError ? <ErrorMessage error={acks.error} /> : (
        <div className="flex flex-col gap-5">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-priority">Pas encore confirmée ({acks.data.pending.length})</h3>
            {acks.data.pending.length === 0 ? <p className="text-sm text-positive">Toute l'équipe l'a lue.</p> : (
              <ul className="flex flex-wrap gap-2">
                {acks.data.pending.map((p) => <li key={p.id} className="rounded-full bg-priority-soft px-3 py-1 text-sm text-priority">{fullName(p)}</li>)}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Confirmée ({acks.data.acked.length})</h3>
            <ul className="flex flex-wrap gap-2">
              {acks.data.acked.map((a) => (
                <li key={a.user.id} className="rounded-full bg-sunken px-3 py-1 text-sm">
                  {a.user.id === me ? 'Vous' : fullName(a.user)} <span className="text-muted">· {formatWhen(a.ackedAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Saisie : Entrée envoie, Maj+Entrée va à la ligne
// ---------------------------------------------------------------------
function Composer({ conversation, editing, onDone }: { conversation: Conversation; editing: Message | null; onDone: () => void }) {
  const send = useSendMessage(conversation.id);
  const edit = useEditMessage();
  const [text, setText] = useState(editing?.body ?? '');
  const area = useRef<HTMLTextAreaElement>(null);
  const busy = send.isPending || edit.isPending;

  // Hauteur automatique, 6 lignes au plus
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(() => { if (editing) area.current?.focus(); }, [editing]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    if (editing) await edit.mutateAsync({ id: editing.id, body });
    else await send.mutateAsync(body);
    setText('');
    onDone();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
    if (event.key === 'Escape' && editing) onDone();
  }

  return (
    <form onSubmit={submit} className="border-t border-line bg-surface px-2 pt-2 pb-2">
      {editing && (
        <p className="mb-1 flex items-center justify-between px-1 text-xs text-muted">
          Modification du message (l'ancien texte est conservé)
          <button type="button" className="underline" onClick={onDone}>Annuler</button>
        </p>
      )}
      <div className="flex items-end gap-2">
        <label className="sr-only" htmlFor={`composer-${conversation.id}`}>Message</label>
        <textarea
          id={`composer-${conversation.id}`}
          ref={area}
          rows={1}
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={conversation.kind === 'announcements' ? 'Rédiger une annonce…' : 'Écrire un message…'}
          className="min-h-11 flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-base focus:border-primary focus:outline-none"
        />
        <Button type="submit" variant="primary" className="min-h-11" busy={busy} disabled={!text.trim()}>
          {editing ? 'Enregistrer' : 'Envoyer'}
        </Button>
      </div>
      <ErrorMessage error={send.error ?? edit.error} />
    </form>
  );
}

// ---------------------------------------------------------------------
// Nouvelle conversation : un collègue, ou un groupe
// ---------------------------------------------------------------------
export function NewConversationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useUser();
  const staff = useStaff();
  const create = useCreateConversation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const colleagues = (staff.data ?? []).filter((s) => s.id !== me.id
    && fullName(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .includes(filter.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')));

  async function open1to1(userId: string) {
    const conversation = await create.mutateAsync({ kind: 'direct', userId });
    close();
    navigate(`/messages/${conversation.id}`);
  }

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    const conversation = await create.mutateAsync({ kind: 'group', title, memberIds: selected });
    close();
    navigate(`/messages/${conversation.id}`);
  }

  function close() {
    setTitle(''); setSelected([]); setFilter(''); setMode('direct'); create.reset();
    onClose();
  }

  return (
    <Dialog open={open} onClose={close} title="Nouvelle conversation">
      <div className="mb-4 flex gap-2" role="tablist">
        <Tab active={mode === 'direct'} onClick={() => setMode('direct')}>Un collègue</Tab>
        <Tab active={mode === 'group'} onClick={() => setMode('group')}>Un groupe</Tab>
      </div>
      <TextField label="Rechercher" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Nom d'un collègue" />
      {staff.isPending ? <Loading /> : mode === 'direct' ? (
        <ul className="mt-3 flex max-h-80 flex-col overflow-y-auto">
          {colleagues.map((s) => (
            <li key={s.id}>
              <button type="button" disabled={create.isPending} onClick={() => void open1to1(s.id)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-sunken">
                <span className="flex size-9 items-center justify-center rounded-full bg-info-soft text-sm font-semibold text-primary">{initials(s)}</span>
                <span>{fullName(s)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <form onSubmit={createGroup} className="mt-3 flex flex-col gap-3">
          <TextField label="Nom du groupe" required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex. : Équipe de nuit" />
          <fieldset className="max-h-64 overflow-y-auto">
            <legend className="mb-1 text-sm font-medium">Membres ({selected.length})</legend>
            {colleagues.map((s) => (
              <Checkbox key={s.id} label={fullName(s)} checked={selected.includes(s.id)}
                onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((id) => id !== s.id))} />
            ))}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button onClick={close}>Annuler</Button>
            <Button type="submit" variant="primary" busy={create.isPending} disabled={!title.trim() || selected.length === 0}>
              Créer le groupe
            </Button>
          </div>
        </form>
      )}
      <ErrorMessage error={create.error} />
    </Dialog>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
      className={cx('rounded-full px-4 py-2 text-sm font-medium', active ? 'bg-primary text-on-primary' : 'bg-sunken text-ink')}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------
// Groupe : renommer, ajouter des collègues, quitter
// ---------------------------------------------------------------------
export function GroupDialog({ conversation, open, onClose }: { conversation: Conversation; open: boolean; onClose: () => void }) {
  const me = useUser();
  const staff = useStaff();
  const rename = useRenameGroup(conversation.id);
  const add = useAddMembers(conversation.id);
  const leave = useLeaveGroup();
  const navigate = useNavigate();
  const [title, setTitle] = useState(conversation.title);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const memberIds = new Set(conversation.members.map((m) => m.id));
  const candidates = (staff.data ?? []).filter((s) => !memberIds.has(s.id));

  return (
    <Dialog open={open} onClose={onClose} title="Groupe">
      <div className="flex flex-col gap-6">
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); rename.mutate(title); }}>
          <div className="flex-1"><TextField label="Nom du groupe" required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <Button type="submit" busy={rename.isPending} disabled={title.trim() === conversation.title}>Renommer</Button>
        </form>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Membres ({conversation.members.length})</h3>
          <ul className="flex flex-wrap gap-2">
            {conversation.members.map((m) => (
              <li key={m.id} className="rounded-full bg-sunken px-3 py-1 text-sm">{m.id === me.id ? 'Vous' : fullName(m)}</li>
            ))}
          </ul>
        </section>

        {candidates.length > 0 && (
          <form onSubmit={(e) => { e.preventDefault(); add.mutate(toAdd, { onSuccess: () => setToAdd([]) }); }}>
            <h3 className="mb-1 text-sm font-semibold">Ajouter des collègues</h3>
            <div className="max-h-48 overflow-y-auto">
              {candidates.map((s) => (
                <Checkbox key={s.id} label={fullName(s)} checked={toAdd.includes(s.id)}
                  onChange={(e) => setToAdd(e.target.checked ? [...toAdd, s.id] : toAdd.filter((id) => id !== s.id))} />
              ))}
            </div>
            <Button type="submit" className="mt-2" busy={add.isPending} disabled={toAdd.length === 0}>Ajouter</Button>
          </form>
        )}

        <div className="border-t border-line pt-4">
          <Button variant="ghost" className="text-danger" busy={leave.isPending}
            onClick={() => {
              if (window.confirm('Quitter ce groupe ? Vous ne verrez plus ses messages.')) {
                leave.mutate(conversation.id, { onSuccess: () => { onClose(); navigate('/messages'); } });
              }
            }}>
            Quitter le groupe
          </Button>
        </div>
        <ErrorMessage error={rename.error ?? add.error ?? leave.error} />
      </div>
    </Dialog>
  );
}
