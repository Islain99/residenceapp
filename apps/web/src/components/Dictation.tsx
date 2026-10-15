// Bouton « Dicter » sous un champ de texte : la voix est transcrite sur
// l'appareil (lib/dictation.ts) et ajoutée au texte. Absent si l'appareil ne
// sait pas transcrire localement.
//
// Trois affichages possibles :
//   « 🎤 Activer la dictée »  le français n'est pas encore installé : clic =
//                            téléchargement (une fois), puis l'écoute commence
//   « 🎤 Dicter »            prêt : clic = le micro s'ouvre
//   « ■ Arrêter »            écoute en cours, avec l'aperçu de ce qui est entendu
//
// Utilisation (components/NoteForm.tsx) :
//   <DictationButton field="intervention"
//     onText={(spoken) => setIntervention((text) => appendDictated(text, spoken))} />
import { useEffect, useRef, useState } from 'react';
import {
  createRecognition, DICTATION_ERRORS, dictationStatus, installDictation, releaseRecognition,
  type DictationStatus, type Recognition,
} from '../lib/dictation';
import { Button } from './ui';

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
          <Button className="min-h-9" onClick={() => recognition.current?.stop()} aria-label={`Arrêter la dictée (${field})`}>
            ■ Arrêter
          </Button>
        ) : status.state === 'available' ? (
          <Button variant="ghost" className="min-h-9 text-primary" onClick={start} aria-label={`Dicter : ${field}`}>
            🎤 Dicter
          </Button>
        ) : (
          // downloadable ou downloading : modèle français à installer
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
