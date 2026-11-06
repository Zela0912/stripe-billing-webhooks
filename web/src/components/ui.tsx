import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Tone } from '../format.ts';

export function Label({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`label label--${tone}`}>{children}</span>;
}

export function Section({
  id,
  title,
  description,
  actions,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section" aria-labelledby={`${id}-title`}>
      <div className="section__header">
        <h2 id={`${id}-title`}>{title}</h2>
        {actions && <div className="section__actions">{actions}</div>}
      </div>
      {description && <p className="section__description">{description}</p>}
      {children}
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'default' | 'link';
  size?: 'sm' | 'md';
  busy?: boolean;
};

export function Button({ variant = 'default', size = 'md', busy = false, children, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`btn btn--${variant} btn--${size} ${props.className ?? ''}`}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
    >
      {children}
      {busy && <span className="btn__busy" aria-hidden="true" />}
    </button>
  );
}
