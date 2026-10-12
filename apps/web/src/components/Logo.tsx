// Logo de l'application (public/logo.png, généré depuis brand/logo-original.png).
// Fond blanc opaque : affiché sur une tuile blanche arrondie, lisible aussi en thème sombre.
import { cx } from '../lib/cx';

export function Logo({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt=""
      className={cx('rounded-lg border border-line bg-white object-contain', className)}
    />
  );
}
