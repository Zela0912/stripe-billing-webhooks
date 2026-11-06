import { PLANS, type WorkspaceView } from '../../../shared/billing.ts';

const SETTINGS = ['General', 'Members', 'Locations', 'Billing', 'Integrations', 'Audit log'];

/**
 * TidyShift's settings navigation. Only Billing is built: the demo is a billing integration
 * that drops into an app that already exists.
 */
export function SettingsNav({ workspace }: { workspace: WorkspaceView | null }) {
  return (
    <nav className="settings-nav" aria-label="Settings">
      <div className="settings-nav__workspace">
        <span className="avatar" aria-hidden="true">
          {workspace?.name[0] ?? ''}
        </span>
        <div>
          <strong>{workspace?.name ?? 'Loading…'}</strong>
          <span>{workspace ? `Workspace · ${PLANS[workspace.plan].name}` : ' '}</span>
        </div>
      </div>
      <ul>
        {SETTINGS.map((item) =>
          item === 'Billing' ? (
            <li key={item}>
              <a href="/" aria-current="page">
                {item}
              </a>
            </li>
          ) : (
            <li key={item}>
              <span title="Not part of this demo">{item}</span>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}

export function TopBar({ demo }: { demo: boolean }) {
  return (
    <header className="topbar">
      <div className="topbar__inner">
        <a href="/" className="topbar__brand">
          <img src="/favicon.svg" alt="" width="24" height="24" />
          TidyShift
        </a>
        <nav className="topbar__nav" aria-label="Product">
          <span>Schedule</span>
          <span>Team</span>
          <span>Time off</span>
          <span>Reports</span>
          <span aria-current="page">Settings</span>
        </nav>
        {demo && <span className="topbar__sandbox">Test mode</span>}
      </div>
    </header>
  );
}
