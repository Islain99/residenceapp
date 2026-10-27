// Messagerie interne. Ordinateur : liste à gauche, fil à droite.
// Téléphone : la liste, puis le fil en plein écran (/messages/:id).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccess } from '../lib/access';
import { Link, useParams } from 'react-router';
import { useConversation, useConversations } from '../api/hooks';
import { useUser } from '../auth/session';
import {
  ConversationAvatar, ConversationListItem, GroupDialog, NewConversationDialog, Thread,
} from '../components/messaging';
import { Button, ErrorMessage, Loading } from '../components/ui';
import { cx } from '../lib/cx';
import { conversationSubtitle, conversationTitle } from '../lib/messaging';

export function MessagesPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const conversations = useConversations();
  const { can } = useAccess();   // Messagerie masquée : seulement les annonces
  const [creating, setCreating] = useState(false);

  return (
    // Hauteur fixe : seul le fil défile (en-tête 56 px, barre du bas 64 px sur téléphone)
    <div className="-my-6 flex h-[calc(100dvh-3.5rem-var(--nav-h))] gap-4 py-3 md:h-[calc(100dvh-3.5rem)] md:py-6">
      <aside className={cx('flex min-h-0 w-full flex-col md:w-80 md:shrink-0', id && 'hidden md:flex')}>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t('messages.title')}</h1>
          {can('messaging', 'full') && <Button data-tour="messages-new" variant="primary" className="min-h-10" onClick={() => setCreating(true)}>{t('messages.new')}</Button>}
        </div>
        {conversations.isPending ? <Loading /> : conversations.isError ? <ErrorMessage error={conversations.error} /> : (
          <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto">
            {conversations.data.map((c) => <ConversationListItem key={c.id} conversation={c} active={c.id === id} />)}
          </ul>
        )}
      </aside>

      <section className={cx('min-h-0 flex-1 flex-col rounded-2xl border-line md:flex md:border md:bg-surface md:px-3', id ? 'flex' : 'hidden')}>
        {id ? <ConversationView key={id} id={id} /> : (
          <div className="m-auto max-w-sm text-center text-muted">
            <p className="mb-3">{t('messages.choose')}</p>
            <Button onClick={() => setCreating(true)}>{t('messages.newConversation')}</Button>
          </div>
        )}
      </section>

      <NewConversationDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function ConversationView({ id }: { id: string }) {
  const { t } = useTranslation();
  const me = useUser();
  // Données de la liste (relue toutes les 15 s, non-lus à jour), sinon la conversation seule
  const list = useConversations();
  const single = useConversation(id);
  const conversation = list.data?.find((c) => c.id === id) ?? single.data;
  const [groupOpen, setGroupOpen] = useState(false);

  if (!conversation) {
    if (single.isError) return <div className="p-4"><ErrorMessage error={single.error} /><Link to="/messages" className="text-primary underline">{t('messages.back')}</Link></div>;
    return <Loading />;
  }

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line py-3">
        <Link to="/messages" className="rounded-lg px-2 py-1 text-xl text-primary md:hidden" aria-label={t('messages.backToList')}>←</Link>
        <ConversationAvatar conversation={conversation} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{conversationTitle(conversation)}</h2>
          <p className="truncate text-xs text-muted">{conversationSubtitle(conversation, me.id)}</p>
        </div>
        {conversation.kind === 'group' && <Button className="min-h-9" onClick={() => setGroupOpen(true)}>{t('messages.group')}</Button>}
      </header>
      {conversation.kind === 'announcements' && conversation.pendingAcks > 0 && (
        <p className="mt-2 rounded-lg bg-priority-soft px-3 py-2 text-sm text-priority">
          {t('messages.pendingAcks', { count: conversation.pendingAcks })}
        </p>
      )}
      <Thread conversation={conversation} />
      {conversation.kind === 'group' && <GroupDialog conversation={conversation} open={groupOpen} onClose={() => setGroupOpen(false)} />}
    </>
  );
}
