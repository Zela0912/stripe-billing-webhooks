import type { ReactNode } from 'react';
import type { Tone } from '../format.ts';

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

export function Card({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = `card-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section className={`card ${className}`} aria-labelledby={id}>
      <header className="card__header">
        <div>
          <h2 id={id} className="card__title">
            {title}
          </h2>
          {description && <p className="card__description">{description}</p>}
        </div>
        {actions && <div className="card__actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Button({
  variant = 'secondary',
  busy = false,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`button button--${variant} ${props.className ?? ''}`}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
