// Rond avec les initiales d'une personne, sur sa couleur (profil, lib/avatar.ts).
import { AVATAR_COLORS, avatarColorOf, initials } from '../lib/avatar';
import { cx } from '../lib/cx';

const SIZES = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-16 text-xl' };

interface Props {
  person: { id: string; firstName: string; lastName: string; avatarColor?: string | null };
  size?: keyof typeof SIZES;
  className?: string;
}

export function Avatar({ person, size = 'md', className }: Props) {
  return (
    <span
      aria-hidden   // le nom est toujours écrit à côté, ou dans le libellé du lien
      className={cx('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-wide text-white', SIZES[size], className)}
      style={{ backgroundColor: AVATAR_COLORS[avatarColorOf(person)].hex }}
    >
      {initials(person.firstName, person.lastName)}
    </span>
  );
}
