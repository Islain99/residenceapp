// Avatar rond d'une personne : son illustration (galerie du profil), sinon ses
// initiales sur sa couleur (lib/avatar.ts). Le temps que les dessins se
// chargent (première fois seulement), les initiales s'affichent.
import { useEffect, useState } from 'react';
import { AVATAR_COLORS, avatarColorOf, avatarKey, cachedAvatarImage, initials, loadAvatarImage } from '../lib/avatar';
import { cx } from '../lib/cx';

const SIZES = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-16 text-xl' };

interface Props {
  person: { id: string; firstName: string; lastName: string; avatar?: string | null; avatarColor?: string | null };
  size?: keyof typeof SIZES;
  className?: string;
}

export function Avatar({ person, size = 'md', className }: Props) {
  const color = avatarColorOf(person);
  const key = person.avatar ? avatarKey(person.avatar, color) : null;
  // Image dessinée pour cet avatar et cette couleur (déjà en mémoire, ou chargée ici)
  const [loaded, setLoaded] = useState<{ key: string; uri: string | null } | null>(null);
  const image = key ? (cachedAvatarImage(key) ?? (loaded?.key === key ? loaded.uri : null)) : null;

  useEffect(() => {
    if (!key || !person.avatar || cachedAvatarImage(key) !== undefined) return;
    let cancelled = false;
    void loadAvatarImage(person.avatar, color).then((uri) => { if (!cancelled) setLoaded({ key, uri }); });
    return () => { cancelled = true; };
  }, [key, person.avatar, color]);

  // aria-hidden : le nom est toujours écrit à côté, ou dans le libellé du lien
  if (image) {
    return <img src={image} alt="" aria-hidden className={cx('shrink-0 rounded-full', SIZES[size], className)} />;
  }
  return (
    <span
      aria-hidden
      className={cx('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-wide text-white', SIZES[size], className)}
      style={{ backgroundColor: AVATAR_COLORS[color].hex }}
    >
      {initials(person.firstName, person.lastName)}
    </span>
  );
}
