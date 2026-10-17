// Dictée des notes, SUR L'APPAREIL SEULEMENT.
//
// La reconnaissance vocale des navigateurs envoie d'ordinaire la voix aux
// serveurs de Google ou d'Apple. Une note parle de la santé d'un résident
// (Loi 25) : on n'utilise que la reconnaissance locale (Web Speech API,
// `processLocally`), vérifiée avant d'afficher le bouton. Navigateur sans
// reconnaissance locale (Firefox, Safari, Chrome ancien) : pas de dictée.
//
// Le modèle de langue français se télécharge une fois par appareil
// (« Activer la dictée »), puis tout se passe hors ligne.
//
// Déroulement :
//   1. dictationStatus()   : l'appareil sait-il transcrire le français localement ?
//   2. installDictation()  : sinon, téléchargement du modèle (une seule fois)
//   3. createRecognition() : une écoute, réglée en mode local, continu
//   4. appendDictated()    : chaque phrase reconnue s'ajoute au texte de la note
// Le bouton (components/Dictation.tsx) enchaîne ces étapes.

// ---------------------------------------------------------------------
// Types de la Web Speech API
//
// TypeScript ne connaît pas encore l'API de reconnaissance vocale (et surtout
// pas sa partie locale, récente) : on décrit ici seulement ce qu'on utilise.
// ---------------------------------------------------------------------

// Un passage reconnu. isFinal = false : proposition provisoire, qui peut encore
// changer pendant que la personne parle ; true : texte définitif.
export interface RecognitionResult { readonly isFinal: boolean; readonly 0: { readonly transcript: string } }

// Événement « result » : la liste de TOUS les passages depuis le début de
// l'écoute ; resultIndex = le premier qui a changé depuis l'événement précédent.
export interface RecognitionEvent { readonly resultIndex: number; readonly results: ArrayLike<RecognitionResult> }

// Une écoute du micro
export interface Recognition {
  lang: string;              // langue parlée (fr-CA…)
  continuous: boolean;       // true : continue après une pause, jusqu'à stop()
  interimResults: boolean;   // true : envoie aussi les propositions provisoires
  processLocally: boolean;   // true : transcription sur l'appareil, refusée sinon
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;   // fin de l'écoute, quelle qu'en soit la raison
  start(): void;
  stop(): void;    // arrêt en douceur : le dernier passage entendu est encore transcrit
  abort(): void;   // arrêt immédiat, sans résultat
}

// État de la reconnaissance locale pour une langue
//   available    : prête, hors ligne
//   downloadable : possible après téléchargement du modèle de la langue
//   downloading  : téléchargement en cours
//   unavailable  : impossible sur cet appareil (on n'affiche pas de bouton)
type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';
interface LocalOptions { langs: string[]; processLocally: true }

// Le « constructeur » SpeechRecognition et ses fonctions de reconnaissance
// locale. available et install n'existent que dans les navigateurs qui
// savent transcrire sur l'appareil (Chrome récent) : leur absence suffit à
// écarter les autres, qui enverraient la voix en ligne.
interface RecognitionClass {
  new(): Recognition;
  available?: (options: LocalOptions) => Promise<Availability>;
  install?: (options: LocalOptions) => Promise<boolean>;
}

// Nom standard, ou préfixé « webkit » selon le navigateur
const recognitionClass = (): RecognitionClass | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

// Français du Québec d'abord, sinon français de France
const LANGS = ['fr-CA', 'fr-FR'];

// Réponse de dictationStatus() : la langue retenue accompagne tout état utilisable
export type DictationStatus = { state: 'unavailable' } | { state: Exclude<Availability, 'unavailable'>; lang: string };

// ---------------------------------------------------------------------
// 1. Disponibilité
// ---------------------------------------------------------------------

// La reconnaissance locale est-elle possible ici, et dans quelle langue ?
// Ne demande pas l'accès au micro : on vérifie seulement ce que le
// navigateur sait faire.
export async function dictationStatus(): Promise<DictationStatus> {
  const SR = recognitionClass();
  // Pas de mode local, ou pas d'accès aux micros (page non sécurisée…) : pas de dictée
  if (!SR?.available || !navigator.mediaDevices) return { state: 'unavailable' };
  for (const lang of LANGS) {
    try {
      const state = await SR.available({ langs: [lang], processLocally: true });
      if (state !== 'unavailable') return { state, lang };
    } catch {
      // langue refusée : essayer la suivante
    }
  }
  return { state: 'unavailable' };
}

// ---------------------------------------------------------------------
// 2. Téléchargement du modèle
// ---------------------------------------------------------------------

// Téléchargement du modèle français sur l'appareil (une fois). À appeler
// après un geste de l'utilisateur (clic) : le navigateur refuse sinon.
// Renvoie false si le téléchargement échoue (pas de réseau…), sans lever d'erreur.
export async function installDictation(lang: string): Promise<boolean> {
  const SR = recognitionClass();
  return SR?.install ? SR.install({ langs: [lang], processLocally: true }).catch(() => false) : false;
}

// ---------------------------------------------------------------------
// 3. Écoute
// ---------------------------------------------------------------------

// Une seule dictée à la fois dans la page : le formulaire de note a deux
// boutons (description, intervention) et un seul micro.
let active: Recognition | null = null;

// Nouvelle écoute, réglée pour la dictée d'une note. Arrête celle d'un autre
// champ s'il y en a une. Les gestionnaires (onresult…) sont posés par
// l'appelant, puis start() lance le micro.
export function createRecognition(lang: string): Recognition {
  const SR = recognitionClass();
  if (!SR) throw new Error('Dictée non disponible.');
  active?.abort();
  const recognition = new SR();
  recognition.lang = lang;
  recognition.processLocally = true;   // jamais de transcription en ligne
  recognition.continuous = true;       // une note se dicte en plusieurs phrases, avec des pauses
  recognition.interimResults = true;   // aperçu de ce qui est entendu, en direct
  active = recognition;
  return recognition;
}

// À appeler à la fin d'une écoute (onend) : elle n'est plus « l'écoute active »
export function releaseRecognition(recognition: Recognition): void {
  if (active === recognition) active = null;
}

// Messages pour les codes d'erreur de la Web Speech API. « aborted » (arrêt
// voulu) et « no-speech » (silence) ne sont pas affichés : ce ne sont pas des
// problèmes.
export const DICTATION_ERRORS: Record<string, string> = {
  'not-allowed': 'Micro refusé : autorisez le micro pour ce site dans les réglages du navigateur.',
  'service-not-allowed': 'Micro refusé : autorisez le micro pour ce site dans les réglages du navigateur.',
  'audio-capture': 'Aucun micro trouvé sur cet appareil.',
  'language-not-supported': 'Le français n’est pas encore installé pour la dictée sur cet appareil.',
  network: 'Dictée sur l’appareil indisponible pour le moment.',
};

// ---------------------------------------------------------------------
// 4. Texte de la note
// ---------------------------------------------------------------------

// Ajoute un passage dicté au texte : espace entre les deux, majuscule en début
// de texte ou de phrase. La reconnaissance ne met pas de ponctuation : on la
// tape à la main en relisant.
//   appendDictated('', 'résident agité')            → 'Résident agité'
//   appendDictated('Au souper.', 'résident agité')  → 'Au souper. Résident agité'
//   appendDictated('Résident agité', 'il a refusé') → 'Résident agité il a refusé'
export function appendDictated(text: string, spoken: string): string {
  const piece = spoken.trim();
  if (!piece) return text;
  const before = text.replace(/\s+$/, '');   // espaces de fin retirés, un seul sera remis
  const newSentence = before === '' || /[.!?]$/.test(before);
  const words = newSentence ? piece.charAt(0).toLocaleUpperCase('fr-CA') + piece.slice(1) : piece;
  return before === '' ? words : `${before} ${words}`;
}
