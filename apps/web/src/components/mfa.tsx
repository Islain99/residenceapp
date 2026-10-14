// Double authentification : saisie du code, configuration (code QR), codes de secours.
import { useState, type FormEvent } from 'react';
import type { MfaSetup } from '../api/types';
import { Button, Checkbox, ErrorMessage, TextField } from './ui';

// Code à 6 chiffres, ou code de secours (« abcd-efgh »)
export function CodeForm({ onSubmit, submitLabel, allowBackup, busy, error }: {
  onSubmit: (code: string) => void;
  submitLabel: string;
  allowBackup?: boolean;
  busy?: boolean;
  error?: unknown;
}) {
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(code.trim());
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {backup ? (
        <TextField key="backup" label="Code de secours" autoComplete="off" autoFocus required maxLength={20}
          placeholder="abcd-efgh" value={code} onChange={(e) => setCode(e.target.value)}
          hint="Un des 10 codes notés à l’activation. Chacun ne sert qu’une fois." />
      ) : (
        <TextField key="totp" label="Code à 6 chiffres" inputMode="numeric" autoComplete="one-time-code" autoFocus required
          pattern="[0-9 ]{6,7}" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)}
          hint="Affiché dans votre application d’authentification ; il change toutes les 30 secondes." />
      )}
      <ErrorMessage error={error} />
      <Button type="submit" variant="primary" busy={busy}>{submitLabel}</Button>
      {allowBackup && (
        <button type="button" className="text-sm text-primary hover:underline" onClick={() => { setBackup(!backup); setCode(''); }}>
          {backup ? 'Utiliser le code de l’application' : 'Téléphone indisponible ? Utiliser un code de secours'}
        </button>
      )}
    </form>
  );
}

// Première configuration : code QR + clé à saisir à la main
export function SetupInstructions({ setup }: { setup: MfaSetup }) {
  const [showKey, setShowKey] = useState(false);
  const grouped = setup.secret.match(/.{1,4}/g)?.join(' ') ?? setup.secret;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <ol className="flex list-decimal flex-col gap-1 pl-5">
        <li>Installez une application d’authentification sur votre téléphone (Google Authenticator, Microsoft Authenticator…).</li>
        <li>Dans l’application, ajoutez un compte en scannant ce code :</li>
      </ol>
      {/* SVG produit par l'API (bibliothèque qrcode) à partir du secret : aucun contenu externe */}
      <div className="mx-auto w-48 rounded-lg bg-white p-2" role="img" aria-label="Code QR à scanner"
        dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
      {showKey ? (
        <p className="text-center">
          Clé à saisir : <code className="select-all rounded bg-sunken px-2 py-1 font-mono text-base tracking-wider">{grouped}</code>
        </p>
      ) : (
        <button type="button" className="text-primary hover:underline" onClick={() => setShowKey(true)}>
          Impossible de scanner ? Afficher la clé à saisir
        </button>
      )}
      <p>3. Entrez le code à 6 chiffres affiché par l’application :</p>
    </div>
  );
}

// Codes de secours : affichés une seule fois
export function BackupCodes({ codes, onDone, doneLabel = 'Continuer' }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = ['Journal de bord — codes de secours (chacun ne sert qu’une fois)', '', ...codes].join('\n');

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'codes-de-secours-journal-de-bord.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p>
        Si vous perdez votre téléphone, ces codes vous permettront de vous connecter. <strong>Notez-les ou imprimez-les</strong>
        {' '}et gardez-les en lieu sûr : ils ne seront plus affichés.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-sunken p-4 font-mono text-base">
        {codes.map((c) => <li key={c} className="text-center tracking-wider">{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}>
          {copied ? 'Copiés ✓' : 'Copier'}
        </Button>
        <Button onClick={download}>Télécharger</Button>
        <Button onClick={() => window.print()}>Imprimer</Button>
      </div>
      <Checkbox label="J’ai noté mes codes de secours en lieu sûr" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
      <Button variant="primary" disabled={!saved} onClick={onDone}>{doneLabel}</Button>
    </div>
  );
}
