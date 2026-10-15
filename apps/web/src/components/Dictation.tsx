// Bouton « Dicter » sous un champ de texte : la voix est transcrite sur
// l'appareil (lib/dictation.ts) et ajoutée au texte. Absent si l'appareil ne
// sait pas transcrire localement.
import { useEffect, useRef, useState } from 'react';
import {
  createRecognition, DICTATION_ERRORS, dictationStatus, installDictation, releaseRecognition,
  type DictationStatus, type Recognition,
} from '../lib/dictation';
import { Button } from './ui';

// Vérifiée une fois par page : la réponse ne change pas d'un champ à l'autre
let statusOnce: Promise<DictationStatus> | null = null;

export function DictationButton({ onText, field }: { onText: (spoken: string) => void; field: string }) {
  const [status, setStatus] = useState<DictationStatus | null>(null);
  const [listening, setListening] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; });

  useEffect(() => {
    let cancelled = false;
    statusOnce ??= dictationStatus();
    void statusOnce.then((s) => { if (!cancelled) setStatus(s); });
    return () => {
      cancelled = true;
      recognition.current?.abort();
    };
  }, []);

  if (!status || status.state === 'unavailable') return null;
  const lang = status.lang;

  function start() {
    setError(null);
    setInterim('');
    const r = createRecognition(lang);
    r.onresult = (event) => {
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        if (result.isFinal) onTextRef.current(result[0].transcript);
        else pending += result[0].transcript;
      }
      setInterim(pending);
    };
    r.onerror = (event) => {
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setError(DICTATION_ERRORS[event.error] ?? 'La dictée s’est arrêtée.');
      }
    };
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

  async function enable() {
    setError(null);
    setInstalling(true);
    statusOnce = null;
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
        {listening && (
          <p aria-live="polite" className="mr-auto min-w-0 flex-1 truncate text-sm italic text-muted">
            <span aria-hidden className="mr-2 inline-block size-2.5 animate-pulse rounded-full bg-danger align-middle" />
            {interim || 'J’écoute…'}
          </p>
        )}
        {listening ? (
          <Button className="min-h-9" onClick={() => recognition.current?.stop()} aria-label={`Arrêter la dictée (${field})`}>
            ■ Arrêter
          </Button>
        ) : status.state === 'available' ? (
          <Button variant="ghost" className="min-h-9 text-primary" onClick={start} aria-label={`Dicter : ${field}`}>
            🎤 Dicter
          </Button>
        ) : (
          <Button variant="ghost" className="min-h-9 text-primary" busy={installing || status.state === 'downloading'}
            onClick={() => void enable()}
            title="Télécharge une seule fois le français sur cet appareil. Ensuite, la voix est transcrite sur l’appareil, sans rien envoyer.">
            🎤 Activer la dictée
          </Button>
        )}
      </div>
      {error && <p role="alert" className="text-right text-sm text-danger">{error}</p>}
    </div>
  );
}
