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

export interface RecognitionResult { readonly isFinal: boolean; readonly 0: { readonly transcript: string } }
export interface RecognitionEvent { readonly resultIndex: number; readonly results: ArrayLike<RecognitionResult> }

export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';
interface LocalOptions { langs: string[]; processLocally: true }
interface RecognitionClass {
  new(): Recognition;
  available?: (options: LocalOptions) => Promise<Availability>;
  install?: (options: LocalOptions) => Promise<boolean>;
}

const recognitionClass = (): RecognitionClass | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

// Français du Québec d'abord, sinon français de France
const LANGS = ['fr-CA', 'fr-FR'];

export type DictationStatus = { state: 'unavailable' } | { state: Exclude<Availability, 'unavailable'>; lang: string };

// La reconnaissance locale est-elle possible ici, et dans quelle langue ?
export async function dictationStatus(): Promise<DictationStatus> {
  const SR = recognitionClass();
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

// Téléchargement du modèle français sur l'appareil (une fois). À appeler
// après un geste de l'utilisateur (clic).
export async function installDictation(lang: string): Promise<boolean> {
  const SR = recognitionClass();
  return SR?.install ? SR.install({ langs: [lang], processLocally: true }).catch(() => false) : false;
}

// Une seule dictée à la fois dans la page
let active: Recognition | null = null;

export function createRecognition(lang: string): Recognition {
  const SR = recognitionClass();
  if (!SR) throw new Error('Dictée non disponible.');
  active?.abort();
  const recognition = new SR();
  recognition.lang = lang;
  recognition.processLocally = true;   // jamais de transcription en ligne
  recognition.continuous = true;
  recognition.interimResults = true;
  active = recognition;
  return recognition;
}

export function releaseRecognition(recognition: Recognition): void {
  if (active === recognition) active = null;
}

export const DICTATION_ERRORS: Record<string, string> = {
  'not-allowed': 'Micro refusé : autorisez le micro pour ce site dans les réglages du navigateur.',
  'service-not-allowed': 'Micro refusé : autorisez le micro pour ce site dans les réglages du navigateur.',
  'audio-capture': 'Aucun micro trouvé sur cet appareil.',
  'language-not-supported': 'Le français n’est pas encore installé pour la dictée sur cet appareil.',
  network: 'Dictée sur l’appareil indisponible pour le moment.',
};

// Ajoute un passage dicté au texte : espace entre les deux, majuscule en début
// de texte ou de phrase.
export function appendDictated(text: string, spoken: string): string {
  const piece = spoken.trim();
  if (!piece) return text;
  const before = text.replace(/\s+$/, '');
  const newSentence = before === '' || /[.!?]$/.test(before);
  const words = newSentence ? piece.charAt(0).toLocaleUpperCase('fr-CA') + piece.slice(1) : piece;
  return before === '' ? words : `${before} ${words}`;
}
