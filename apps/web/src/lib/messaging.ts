// Messagerie : textes calculés à partir d'une conversation, dans la langue de
// l'interface.
import type { Conversation } from '../api/types';
import i18n from '../i18n';

// Canaux Équipe et Annonces : nommés en français par le serveur, traduits ici
export function conversationTitle(conversation: Conversation): string {
  if (conversation.kind === 'team') return i18n.t('messages.teamTitle');
  if (conversation.kind === 'announcements') return i18n.t('messages.announcementsTitle');
  return conversation.title;
}

export function conversationSubtitle(conversation: Conversation, meId: string) {
  if (conversation.kind === 'team') return i18n.t('messages.subtitle.team', { count: conversation.memberCount });
  if (conversation.kind === 'announcements') return i18n.t('messages.subtitle.announcements');
  if (conversation.kind === 'direct') return i18n.t('messages.subtitle.direct');
  const others = conversation.members.filter((m) => m.id !== meId).map((m) => m.firstName);
  return i18n.t('messages.subtitle.group', { names: others.join(', ') });
}
