import {
  CalendarDays,
  ChartColumn,
  CreditCard,
  ExternalLink,
  LayoutDashboard,
  type LucideIcon,
  Plane,
  Plug,
  Settings,
  UserRound,
  Users,
} from 'lucide-react';
import { PLANS, type WorkspaceView } from '../../../shared/billing.ts';
import { Badge } from './ui.tsx';

const PRODUCT_NAV: [string, LucideIcon][] = [
  ['Dashboard', LayoutDashboard],
  ['Schedule', CalendarDays],
  ['Team', Users],
  ['Time off', Plane],
  ['Reports', ChartColumn],
];

const SETTINGS_NAV: [string, LucideIcon][] = [
  ['General', Settings],
  ['Members', UserRound],
  ['Billing', CreditCard],
  ['Integrations', Plug],
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

/**
 * The rest of TidyShift around the billing page. Only Billing is built: the point of the
 * demo is a billing integration that drops into an app that already exists.
 */
export function Sidebar({ workspace }: { workspace: WorkspaceView | null }) {
  return (
    <aside className="sidebar" aria-label="TidyShift">
      <div className="sidebar__brand">
        <img src="/favicon.svg" alt="" width="24" height="24" />
        <span>TidyShift</span>
      </div>

      <div className="workspace-switcher">
        <span className="avatar" aria-hidden="true">
          {workspace ? initials(workspace.name) : '··'}
        </span>
        <span className="workspace-switcher__text">
          <span className="workspace-switcher__name">{workspace?.name ?? 'Loading…'}</span>
          <span className="workspace-switcher__plan">
            {workspace ? `${PLANS[workspace.plan].name} plan · ${workspace.employees} employees` : ' '}
          </span>
        </span>
      </div>

      <nav className="nav" aria-label="Main">
        <NavGroup items={PRODUCT_NAV} />
        <p className="nav__label">Settings</p>
        <NavGroup items={SETTINGS_NAV} active="Billing" />
      </nav>

      <div className="sidebar__footer">
        <Badge tone="warning" dot>
          Stripe sandbox
        </Badge>
        <p>A portfolio demo with a fictional company. No real money moves.</p>
        <a href="https://github.com/Zela0912/stripe-billing-webhooks" className="sidebar__link">
          Source on GitHub <ExternalLink size={13} aria-hidden="true" />
        </a>
      </div>
    </aside>
  );
}

function NavGroup({ items, active }: { items: [string, LucideIcon][]; active?: string }) {
  return (
    <ul className="nav__list">
      {items.map(([label, Icon]) => (
        <li key={label}>
          {label === active ? (
            <a href="/" className="nav__item is-active" aria-current="page">
              <Icon size={16} aria-hidden="true" />
              {label}
            </a>
          ) : (
            <span className="nav__item is-disabled" title="Not part of this demo">
              <Icon size={16} aria-hidden="true" />
              {label}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
