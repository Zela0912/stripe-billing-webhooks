import type { WorkspaceView } from '../../../shared/billing.ts';
import { longDate } from '../format.ts';
import { Button } from './ui.tsx';

interface Props {
  workspace: WorkspaceView;
  busy: string | null;
  onAdvance: () => void;
  onCard: (card: 'working' | 'failing') => void;
}

/** Sandbox-only tools for showing what happens when a renewal fails. */
export function DemoControls({ workspace, busy, onAdvance, onCard }: Props) {
  const demo = workspace.demo;
  if (!demo) return null;
  const subscribed = workspace.hasActiveSubscription;
  const advancing = demo.clockStatus === 'advancing';

  return (
    <section className="demo" aria-labelledby="demo-title">
      <div className="demo__header">
        <h2 id="demo-title">Test mode</h2>
        <span className="muted small">
          Stripe sandbox · simulated date{' '}
          <strong>{demo.clockTime ? longDate(demo.clockTime) : 'set at first checkout'}</strong>
        </span>
      </div>
      <ol className="demo__steps">
        <li>
          Subscribe with card <code>4242 4242 4242 4242</code>, any future expiry and any CVC.
        </li>
        <li>
          <span>Charge renewals to</span>
          <select
            aria-label="Card used for renewals"
            value={demo.card}
            disabled={!subscribed || busy === 'card'}
            onChange={(e) => onCard(e.target.value === 'failing' ? 'failing' : 'working')}
          >
            <option value="working">Visa 4242 (succeeds)</option>
            <option value="failing">Visa 0341 (declines)</option>
          </select>
        </li>
        <li>
          <span>Move the clock past the renewal date so Stripe bills it.</span>
          <Button size="sm" busy={busy === 'advance' || advancing} disabled={!subscribed} onClick={onAdvance}>
            {advancing ? 'Billing…' : 'Advance to renewal'}
          </Button>
        </li>
        <li>Switch back to the card that succeeds and use Pay now.</li>
      </ol>
    </section>
  );
}
