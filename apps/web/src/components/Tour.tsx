// Visite guidée interactive : met en évidence un élément de l'écran (un « trou »
// dans un voile sombre) avec une bulle d'explication, étape par étape. La page
// reste utilisable : on peut toucher l'élément mis en évidence.
//
// TourHost se place dans chaque cadre de pages (Layout, PlatformLayout) ;
// la visite se lance avec startTour() (page Aide, invitation TourOffer).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { useAuth, useUser } from '../auth/session';
import { cx } from '../lib/cx';
import { goToStep, markTourSeen, startTour, stopTour, tourForRole, TOURS, tourSeen, useTourState } from '../lib/tour';
import { Button } from './ui';

interface Box { top: number; left: number; width: number; height: number }

const PAD = 6;              // marge autour de l'élément mis en évidence
const CARD_W = 352;         // largeur de la bulle (22rem)

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

// Premier élément visible parmi les cibles, dans l'ordre donné
function findTarget(targets: string[] | undefined): HTMLElement | null {
  for (const name of targets ?? []) {
    const match = [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)].find(visible);
    if (match) return match;
  }
  return null;
}

export function TourHost() {
  const { t } = useTranslation();
  const user = useUser();
  const tour = useTourState();
  const navigate = useNavigate();
  const location = useLocation();
  const cardRef = useRef<HTMLDivElement>(null);
  // Mesure de l'élément, attachée à l'étape mesurée (une ancienne mesure ne sert pas)
  const [measured, setMeasured] = useState<{ id: string; box: Box | null } | null>(null);
  const [cardH, setCardH] = useState(0);
  const [, setViewport] = useState(0);   // nouveau rendu au redimensionnement

  const steps = tour ? TOURS[tour.id] : [];
  const step = tour ? steps[tour.step] : undefined;
  const last = tour ? tour.step === steps.length - 1 : false;
  const stepId = tour ? `${tour.id}:${tour.step}` : '';
  const box = measured?.id === stepId ? measured.box : null;

  const finish = useCallback(() => {
    markTourSeen(user.id);
    stopTour();
  }, [user.id]);

  // Page de l'étape
  useEffect(() => {
    if (step?.route && location.pathname !== step.route) void navigate(step.route);
  }, [step, location.pathname, navigate]);

  // Élément à mettre en évidence : attendu jusqu'à 2 s (page en chargement),
  // puis suivi au défilement et au redimensionnement
  useEffect(() => {
    if (!step) return;
    const id = stepId;
    let el: HTMLElement | null = null;
    let frame = 0;
    const measure = () => {
      if (!el || !el.isConnected || !visible(el)) el = findTarget(step.targets);
      if (!el) { setMeasured({ id, box: null }); return; }
      const r = el.getBoundingClientRect();
      setMeasured({ id, box: { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 } });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const started = Date.now();
    const poll = setInterval(() => {
      el = findTarget(step.targets);
      if (el || Date.now() - started > 2000) {
        clearInterval(poll);
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        schedule();
      }
    }, 100);
    const onResize = () => { setViewport(window.innerWidth + window.innerHeight); schedule(); };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', onResize);
    return () => {
      clearInterval(poll);
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', onResize);
    };
  }, [step, stepId, location.pathname]);

  // Bulle : focus à chaque étape (lecteur d'écran, clavier) ; Échap, flèches
  useLayoutEffect(() => {
    if (!tour) return;
    cardRef.current?.focus();
    setCardH(cardRef.current?.offsetHeight ?? 0);
  }, [tour, box]);

  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight' && !last) goToStep(tour.step + 1);
      if (e.key === 'ArrowLeft' && tour.step > 0) goToStep(tour.step - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tour, last, finish]);

  if (!tour || !step) return null;

  // Position de la bulle : sous l'élément s'il y a la place, sinon au-dessus ;
  // sans élément, au centre. Toujours dans l'écran (16 px de marge).
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_W, vw - 32);
  let style: CSSProperties;
  if (box) {
    const below = box.top + box.height + 12;
    const above = box.top - 12 - cardH;
    const top = below + cardH < vh - 16 ? below : above > 16 ? above : Math.max(16, vh - cardH - 16);
    const left = Math.min(Math.max(16, box.left + box.width / 2 - width / 2), vw - width - 16);
    style = { top, left, width };
  } else {
    style = { top: Math.max(16, vh / 2 - cardH / 2), left: vw / 2 - width / 2, width };
  }

  return createPortal(
    <>
      {/* Voile : un « trou » autour de l'élément (ombre géante), sans bloquer la page */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-40">
        {box ? (
          <div className="absolute rounded-xl ring-2 ring-primary transition-all duration-200"
            style={{ ...box, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)' }} />
        ) : <div className="absolute inset-0 bg-black/55" />}
      </div>
      <div ref={cardRef} role="dialog" aria-modal="false" aria-label={t('help.tour.dialog')} tabIndex={-1}
        className="fixed z-50 rounded-2xl border border-line bg-surface p-4 text-ink shadow-xl outline-none"
        style={style}>
        <p className="text-xs font-medium text-muted" aria-live="polite">
          {t('help.tour.progress', { n: tour.step + 1, total: steps.length })}
        </p>
        <h2 className="mt-1 text-lg font-semibold">{t(`help.tour.steps.${step.key}.title`)}</h2>
        <p className="mt-1 text-sm">{t(`help.tour.steps.${step.key}.body`)}</p>
        {/* Avancement : un trait par étape */}
        <div aria-hidden className="mt-3 flex gap-1">
          {steps.map((s, i) => (
            <span key={`${s.key}-${i}`} className={cx('h-1 flex-1 rounded-full', i <= tour.step ? 'bg-primary' : 'bg-line')} />
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={finish} className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
            {t('help.tour.skip')}
          </button>
          <div className="flex gap-2">
            {tour.step > 0 && <Button className="min-h-10" onClick={() => goToStep(tour.step - 1)}>{t('help.tour.prev')}</Button>}
            <Button variant="primary" className="min-h-10" onClick={() => (last ? finish() : goToStep(tour.step + 1))}>
              {last ? t('help.tour.finish') : t('help.tour.next')}
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

// Invitation à la première connexion sur cet appareil (une seule fois)
export function TourOffer() {
  const { t } = useTranslation();
  const user = useUser();
  const { assistance } = useAuth();
  const tour = useTourState();
  const [seen, setSeen] = useState(() => tourSeen(user.id));
  if (seen || tour || assistance) return null;
  const close = () => { markTourSeen(user.id); setSeen(true); };
  return (
    <div role="status"
      className="fixed inset-x-4 bottom-[calc(var(--nav-h,0px)+1rem)] z-30 rounded-2xl border border-line bg-surface p-4 shadow-xl sm:left-auto sm:w-80 md:bottom-6">
      <p className="font-semibold">{t('help.tour.offer.title')}</p>
      <p className="mt-1 text-sm text-muted">{t('help.tour.offer.body')}</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" className="min-h-10" onClick={close}>{t('help.tour.offer.later')}</Button>
        <Button variant="primary" className="min-h-10" onClick={() => { setSeen(true); startTour(tourForRole(user.role)); }}>
          {t('help.tour.offer.start')}
        </Button>
      </div>
    </div>
  );
}
