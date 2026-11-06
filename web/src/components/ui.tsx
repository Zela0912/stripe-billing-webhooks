import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Tone } from '../format.ts';

export function Badge({
  tone = 'neutral',
  dot = false,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Section({
  id,
  title,
  description,
  actions,
  children,
  className = '',
}: {
  id: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`section ${className}`} aria-labelledby={`${id}-title`}>
      <header className="section__header">
        <div className="section__heading">
          <h2 id={`${id}-title`} className="section__title">
            {title}
          </h2>
          {description && <p className="section__description">{description}</p>}
        </div>
        {actions && <div className="section__actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  busy?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = 'secondary', size = 'md', busy = false, icon, children, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`button button--${variant} button--${size} ${props.className ?? ''}`}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      <span className="switch__label">{label}</span>
    </label>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <code className="kbd">{children}</code>;
}
