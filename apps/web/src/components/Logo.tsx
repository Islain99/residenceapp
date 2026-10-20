// Logo de l'application, sur fond transparent (généré par `npm run icons`
// depuis brand/logo-original.png). Thème sombre : version au bleu marine
// éclairci. Le thème est celui choisi dans « Mon profil » (lib/theme.ts), pas
// forcément celui de l'appareil.
import { cx } from '../lib/cx';
import { useResolvedTheme } from '../lib/theme';

export function Logo({ className }: { className?: string }) {
  const theme = useResolvedTheme();
  return <img src={theme === 'dark' ? '/logo-dark.png' : '/logo.png'} alt="" className={cx('object-contain', className)} />;
}
