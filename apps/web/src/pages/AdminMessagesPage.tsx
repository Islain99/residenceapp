// Administration › Messagerie (responsable). Conversations privées et de
// groupe, sans leur contenu. En cas de plainte ou d'enquête, la responsable
// peut en consulter une, avec un motif obligatoire inscrit au journal d'audit.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminConversations, useConsultConversation } from '../api/hooks';
import type { AdminConversation, ConsultedMessage } from '../api/types';
import { Badge, Button, Dialog, EmptyState, ErrorMessage, Loading, PageHeader, TextArea } from '../components/ui';
import { formatFull, formatWhen, fullName } from '../lib/format';

export function AdminMessagesPage() {
  const { t } = useTranslation();
  const conversations = useAdminConversations();
  const [selected, setSelected] = useState<AdminConversation | null>(null);

  return (
    <>
      <PageHeader
        title={t('messages.admin.title')}
        subtitle={t('messages.admin.subtitle')}
      />
      {conversations.isPending ? <Loading /> : conversations.isError ? <ErrorMessage error={conversations.error} /> :
        conversations.data.length === 0 ? <EmptyState>{t('messages.admin.empty')}</EmptyState> : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {conversations.data.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <Badge>{c.kind === 'group' ? t('messages.admin.group') : t('messages.admin.private')}</Badge>
                    {c.title ?? c.members.map(fullName).join(t('messages.admin.and'))}
                  </p>
                  <p className="text-sm text-muted">
                    {c.kind === 'group' && `${c.members.map((m) => m.firstName).join(', ')} · `}
                    {t('messages.admin.count', { count: c.messageCount })}
                    {c.lastMessageAt && t('messages.admin.last', { when: formatWhen(c.lastMessageAt) })}
                  </p>
                </div>
                <Button onClick={() => setSelected(c)} disabled={c.messageCount === 0}>{t('messages.admin.consult')}</Button>
              </li>
            ))}
          </ul>
        )}
      {selected && <ConsultDialog conversation={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function ConsultDialog({ conversation, onClose }: { conversation: AdminConversation; onClose: () => void }) {
  const { t } = useTranslation();
  const consult = useConsultConversation();
  const [reason, setReason] = useState('');
  const [messages, setMessages] = useState<ConsultedMessage[] | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await consult.mutateAsync({ id: conversation.id, reason });
    setMessages(result.messages);
  }

  return (
    <Dialog open onClose={onClose} title={conversation.title ?? conversation.members.map(fullName).join(t('messages.admin.and'))}>
      {messages === null ? (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="rounded-lg bg-priority-soft px-3 py-2 text-sm text-priority">
            {t('messages.admin.warning')}
          </p>
          <TextArea label={t('messages.admin.reason')} required minLength={10} maxLength={500} rows={3} value={reason}
            onChange={(e) => setReason(e.target.value)} placeholder={t('messages.admin.reasonPlaceholder')} />
          <ErrorMessage error={consult.error} />
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" busy={consult.isPending} disabled={reason.trim().length < 10}>{t('messages.admin.submit')}</Button>
          </div>
        </form>
      ) : (
        <ol className="flex flex-col gap-3">
          {messages.map((m) => (
            <li key={m.id} className="rounded-lg border border-line p-3 text-sm">
              <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-semibold text-ink">{fullName(m.author)}</span>
                {formatFull(m.createdAt)}
                {m.retractedAt && <Badge tone="danger">{t('messages.admin.retractedAt', { when: formatWhen(m.retractedAt) })}</Badge>}
                {m.editedAt && <Badge>{t('messages.admin.edited')}</Badge>}
              </p>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              {m.versions.length > 0 && (
                <ul className="mt-2 border-l-2 border-line pl-3 text-xs text-muted">
                  {m.versions.map((v, i) => (
                    <li key={i}>{t('messages.admin.version', { when: formatWhen(v.replacedAt), text: v.body })}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}
