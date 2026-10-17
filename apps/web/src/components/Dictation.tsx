// Bouton « Dicter » sous un champ de texte : la voix est transcrite sur
// l'appareil (lib/dictation.ts) et ajoutée au texte. Absent si l'appareil ne
// sait pas transcrire localement.
//
// Bouton rond, icône seule (le libellé est lu par les lecteurs d'écran et
// s'affiche en infobulle). Quatre affichages :
//   micro + flèche     le français n'est pas encore installé : clic =
//                      téléchargement (une fois), puis l'écoute commence
//   roue qui tourne    téléchargement en cours
//   micro              prêt : clic = le micro s'ouvre
//   carré, fond rouge  écoute en cours (halo qui pulse), avec l'aperçu de ce
//                      qui est entendu ; clic = arrêt
//
// Utilisation (components/NoteForm.tsx) :
//   <DictationButton field="intervention"
//     onText={(spoken) => setIntervention((text) => appendDictated(text, spoken))} />
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import {
  createRecognition, DICTATION_ERRORS, dictationStatus, installDictation, releaseRecognition,
  type DictationStatus, type Recognition,
} from '../lib/dictation';
import { Spinner } from './ui';

// Vérifiée une fois par page : la réponse ne change pas d'un champ à l'autre
// (les deux boutons du formulaire partagent la même vérification)
let statusOnce: Promise<DictationStatus> | null = null;

interface Props {
  onText: (spoken: string) => void;   // reçoit chaque passage définitif, à ajouter au champ
  field: string;                      // nom du champ, pour les lecteurs d'écran (« Dicter : intervention »)
}

export function DictationButton({ onText, field }: Props) {
  const [status, setStatus] = useState<DictationStatus | null>(null);   // null : vérification en cours
  const [listening, setListening] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [interim, setInterim] = useState('');          // proposition provisoire, affichée en italique
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);   // écoute en cours de CE bouton
  // Dernière version de onText : l'écoute, créée une fois, appelle toujours la
  // fonction à jour du formulaire
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; });

  // À l'affichage : vérifier si la dictée locale est possible. À la fermeture
  // du formulaire : couper le micro s'il est encore ouvert.
  useEffect(() => {
    let cancelled = false;
    statusOnce ??= dictationStatus();
    void statusOnce.then((s) => { if (!cancelled) setStatus(s); });
    return () => {
      cancelled = true;
      recognition.current?.abort();
    };
  }, []);

  // Pas de dictée locale possible : aucun bouton (on tape la note)
  if (!status || status.state === 'unavailable') return null;
  const lang = status.lang;

  // Ouvre le micro. Le navigateur demande l'autorisation la première fois.
  function start() {
    setError(null);
    setInterim('');
    const r = createRecognition(lang);
    // Passages reconnus : les définitifs vont dans le champ, les provisoires
    // dans l'aperçu (ils seront remplacés par leur version définitive)
    r.onresult = (event) => {
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        if (result.isFinal) onTextRef.current(result[0].transcript);
        else pending += result[0].transcript;
      }
      setInterim(pending);
    };
    // Arrêt voulu ou silence : rien à signaler ; sinon, message clair
    r.onerror = (event) => {
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setError(DICTATION_ERRORS[event.error] ?? 'La dictée s’est arrêtée.');
      }
    };
    // Fin de l'écoute (bouton Arrêter, erreur, autre champ dicté) : retour au bouton « Dicter »
    r.onend = () => {
      releaseRecognition(r);
      if (recognition.current === r) recognition.current = null;
      setListening(false);
      setInterim('');
    };
    recognition.current = r;
    r.start();
    setListening(true);
  }

  // Première fois : télécharger le français sur l'appareil, puis écouter
  async function enable() {
    setError(null);
    setInstalling(true);
    statusOnce = null;   // la prochaine vérification verra le modèle installé
    const ok = await installDictation(lang);
    setInstalling(false);
    if (!ok) {
      setError('Le téléchargement du français pour la dictée n’a pas abouti. Réessayez avec une bonne connexion.');
      return;
    }
    setStatus({ state: 'available', lang });
    start();
  }

  return (
    <div className="-mt-2 flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* Pendant l'écoute : point rouge et ce qui est entendu (annoncé aux lecteurs d'écran) */}
        {listening && (
          <p aria-live="polite" className="mr-auto min-w-0 flex-1 truncate text-sm italic text-muted">
            <span aria-hidden className="mr-2 inline-block size-2.5 animate-pulse rounded-full bg-danger align-middle" />
            {interim || 'J’écoute…'}
          </p>
        )}
        {listening ? (
          // stop() et non abort() : la fin de la dernière phrase est encore transcrite
          <MicButton tone="listening" label={`Arrêter la dictée (${field})`} onClick={() => recognition.current?.stop()}>
            <StopIcon />
          </MicButton>
        ) : status.state === 'available' ? (
          <MicButton label={`Dicter : ${field}`} onClick={start}>
            <MicIcon />
          </MicButton>
        ) : installing || status.state === 'downloading' ? (
          <MicButton label="Installation du français pour la dictée…" disabled>
            <Spinner small />
          </MicButton>
        ) : (
          // downloadable : modèle français à installer (une fois), puis l'écoute commence
          <MicButton label={`Activer la dictée : ${field} (télécharge une seule fois le français sur cet appareil ; la voix reste sur l’appareil)`}
            onClick={() => void enable()} badge>
            <MicIcon />
          </MicButton>
        )}
      </div>
      {error && <p role="alert" className="text-right text-sm text-danger">{error}</p>}
    </div>
  );
}

// Bouton rond, icône seule. Le libellé (lecteurs d'écran) sert aussi d'infobulle.
//   tone « listening » : rouge plein, avec un halo qui pulse pendant l'écoute
//   badge : petite flèche de téléchargement (français à installer)
function MicButton({ label, onClick, disabled, tone = 'idle', badge, children }: {
  label: string; onClick?: () => void; disabled?: boolean; tone?: 'idle' | 'listening'; badge?: boolean; children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'relative inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors',
        'disabled:cursor-wait disabled:opacity-70',
        tone === 'listening'
          ? 'bg-danger text-white shadow-md hover:opacity-90'
          : 'border border-line bg-surface text-primary shadow-sm hover:border-primary hover:bg-info-soft',
      )}
    >
      {tone === 'listening' && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-danger opacity-30" />}
      <span className="relative">{children}</span>
      {badge && (
        <span aria-hidden className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-on-primary">
          <svg viewBox="0 0 16 16" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3v8M4.5 7.5 8 11l3.5-3.5" />
          </svg>
        </span>
      )}
    </button>
  );
}

// Micro : capsule, arceau, pied
function MicIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2.5" width="6" height="12" rx="3" fill="currentColor" fillOpacity="0.15" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21M8.5 21h7" />
    </svg>
  );
}

// Arrêt : carré aux coins arrondis
function StopIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="currentColor">
      <rect x="5" y="5" width="14" height="14" rx="3" />
    </svg>
  );
}
