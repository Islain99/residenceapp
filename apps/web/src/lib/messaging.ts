// Messagerie : textes calculés à partir d'une conversation.
import type { Conversation } from '../api/types';

export function conversationSubtitle(conversation: Conversation, meId: string) {
  if (conversation.kind === 'team') return `Toute l'équipe · ${conversation.memberCount} personnes`;
  if (conversation.kind === 'announcements') return "Annonces de l'infirmière et de la responsable";
  if (conversation.kind === 'direct') return 'Conversation privée';
  const others = conversation.members.filter((m) => m.id !== meId).map((m) => m.firstName);
  return `Vous, ${others.join(', ')}`;
}
