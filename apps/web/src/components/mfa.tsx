// Double authentification : saisie du code, configuration (code QR), codes de secours.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(code.trim());
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {backup ? (
        <TextField key="backup" label={t('auth.mfa.backupCode')} autoComplete="off" autoFocus required maxLength={20}
          placeholder="abcd-efgh" value={code} onChange={(e) => setCode(e.target.value)}
          hint={t('auth.mfa.backupCodeHint')} />
      ) : (
        <TextField key="totp" label={t('auth.mfa.totpCode')} inputMode="numeric" autoComplete="one-time-code" autoFocus required
          pattern="[0-9 ]{6,7}" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)}
          hint={t('auth.mfa.totpCodeHint')} />
      )}
      <ErrorMessage error={error} />
      <Button type="submit" variant="primary" busy={busy}>{submitLabel}</Button>
      {allowBackup && (
        <button type="button" className="text-sm text-primary hover:underline" onClick={() => { setBackup(!backup); setCode(''); }}>
          {backup ? t('auth.mfa.useApp') : t('auth.mfa.useBackup')}
        </button>
      )}
    </form>
  );
}

// Première configuration : code QR + clé à saisir à la main
export function SetupInstructions({ setup }: { setup: MfaSetup }) {
  const { t } = useTranslation();
  const [showKey, setShowKey] = useState(false);
  const grouped = setup.secret.match(/.{1,4}/g)?.join(' ') ?? setup.secret;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <ol className="flex list-decimal flex-col gap-1 pl-5">
        <li>{t('auth.mfa.step1')}</li>
        <li>{t('auth.mfa.step2')}</li>
      </ol>
      {/* SVG produit par l'API (bibliothèque qrcode) à partir du secret : aucun contenu externe */}
      <div className="mx-auto w-48 rounded-lg bg-white p-2" role="img" aria-label={t('auth.mfa.qrLabel')}
        dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
      {showKey ? (
        <p className="text-center">
          {t('auth.mfa.keyToType')} <code className="select-all rounded bg-sunken px-2 py-1 font-mono text-base tracking-wider">{grouped}</code>
        </p>
      ) : (
        <button type="button" className="text-primary hover:underline" onClick={() => setShowKey(true)}>
          {t('auth.mfa.showKey')}
        </button>
      )}
      <p>{t('auth.mfa.step3')}</p>
    </div>
  );
}

// Codes de secours : affichés une seule fois
export function BackupCodes({ codes, onDone, doneLabel }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = [t('auth.mfa.backupFileTitle'), '', ...codes].join('\n');

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = t('auth.mfa.backupFileName');
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p>
        {t('auth.mfa.backupIntro')} <strong>{t('auth.mfa.backupKeep')}</strong> {t('auth.mfa.backupKeepEnd')}
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-sunken p-4 font-mono text-base">
        {codes.map((c) => <li key={c} className="text-center tracking-wider">{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}>
          {copied ? t('auth.mfa.copied') : t('auth.mfa.copy')}
        </Button>
        <Button onClick={download}>{t('auth.mfa.download')}</Button>
        <Button onClick={() => window.print()}>{t('auth.mfa.print')}</Button>
      </div>
      <Checkbox label={t('auth.mfa.savedConfirm')} checked={saved} onChange={(e) => setSaved(e.target.checked)} />
      <Button variant="primary" disabled={!saved} onClick={onDone}>{doneLabel ?? t('common.continue')}</Button>
    </div>
  );
}
