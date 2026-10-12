// Logo de l'application, sur fond transparent (généré par `npm run icons`
// depuis brand/logo-original.png). Thème sombre : version au bleu marine
// éclairci, choisie par le navigateur selon le réglage de l'appareil.
import { cx } from '../lib/cx';

export function Logo({ className }: { className?: string }) {
  return (
    <picture className="contents">
      <source srcSet="/logo-dark.png" media="(prefers-color-scheme: dark)" />
      <img src="/logo.png" alt="" className={cx('object-contain', className)} />
    </picture>
  );
}
