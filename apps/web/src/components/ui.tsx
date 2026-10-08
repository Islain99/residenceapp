// Composants d'interface de base, partagés par toutes les pages.
import {
  useEffect, useId, useRef,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';

import { cx } from '../lib/cx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'bg-surface text-ink border border-line hover:bg-sunken',
  ghost: 'text-ink hover:bg-sunken',
  danger: 'bg-danger text-white hover:opacity-90',
};

export function Button({ variant = 'secondary', className, busy, children, disabled, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || busy}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant], className,
      )}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl border border-line bg-surface', className)}>{children}</div>;
}

type Tone = 'neutral' | 'priority' | 'positive' | 'danger' | 'info';
const TONES: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted',
  priority: 'bg-priority-soft text-priority',
  positive: 'bg-positive-soft text-positive',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-primary',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', TONES[tone])}>
      {children}
    </span>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      role="status"
      aria-label="Chargement"
      className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', small ? 'size-4' : 'size-6')}
    />
  );
}

export function Loading() {
  return <div className="flex justify-center py-12 text-primary"><Spinner /></div>;
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Une erreur est survenue.';
  return <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{message}</p>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

const control = 'w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base text-ink placeholder:text-muted sm:text-sm';

function Field({ label, hint, children, id }: { label: string; hint?: string; children: ReactNode; id: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function TextField({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  return <Field label={label} hint={hint} id={id}><input id={id} className={control} {...props} /></Field>;
}

export function TextArea({ label, hint, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  const id = useId();
  return <Field label={label} hint={hint} id={id}><textarea id={id} rows={4} className={control} {...props} /></Field>;
}

export function SelectField({ label, hint, children, ...props }:
  SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string }) {
  const id = useId();
  return <Field label={label} hint={hint} id={id}><select id={id} className={control} {...props}>{children}</select></Field>;
}

export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <input type="checkbox" className="size-5 accent-primary" {...props} />
      {label}
    </label>
  );
}

// Bouton-filtre activable (« Prioritaires », « Non lues »…)
export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'min-h-9 rounded-full border px-3 text-sm font-medium',
        active ? 'border-primary bg-primary text-on-primary' : 'border-line bg-surface text-ink hover:bg-sunken',
      )}
    >
      {children}
    </button>
  );
}

// Fenêtre modale (élément <dialog> natif : focus, Échap et accessibilité gérés)
export function Dialog({ open, onClose, title, children }:
  { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      className="m-auto w-[min(40rem,calc(100vw-1rem))] rounded-2xl border border-line bg-surface p-0 text-ink"
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-lg p-2 text-muted hover:bg-sunken">✕</button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
