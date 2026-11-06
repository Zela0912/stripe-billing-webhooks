import type { WorkspaceView } from '../../../shared/billing.ts';
import { longDate } from '../format.ts';
import { Button, Card, Pill } from './ui.tsx';

interface Props {
  workspace: WorkspaceView;
  busy: string | null;
  onAdvance: () => void;
  onCard: (card: 'working' | 'failing') => void;
}

export function DemoPanel({ workspace, busy, onAdvance, onCard }: Props) {
  const demo = workspace.demo;
  if (!demo) return null;
  const subscribed = workspace.hasActiveSubscription;
  const advancing = demo.clockStatus === 'advancing';

  return (
    <Card
      title="Demo controls"
      className="card--demo area-demo"
      description="Everything runs in a Stripe sandbox. No real money moves."
    >
      <div className="demo">
        <div className="demo__step">
          <h3>1. Subscribe with a test card</h3>
          <p>
            Card <code>4242 4242 4242 4242</code>, any future date, any CVC. For 3D Secure, use{' '}
            <code>4000 0027 6000 3184</code>.
          </p>
        </div>

        <div className="demo__step">
          <h3>2. Make the next renewal fail</h3>
          <fieldset className="segmented segmented--wide" disabled={!subscribed || busy === 'card'}>
            <legend className="sr-only">Card used for renewals</legend>
            {(['working', 'failing'] as const).map((card) => (
              <label key={card} className={demo.card === card ? 'is-selected' : ''}>
                <input
                  type="radio"
                  name="demo-card"
                  value={card}
                  checked={demo.card === card}
                  onChange={() => onCard(card)}
                />
                {card === 'working' ? 'Working card' : 'Card that declines'}
              </label>
            ))}
          </fieldset>
        </div>

        <div className="demo__step">
          <h3>3. Jump to the renewal date</h3>
          <p>
            A Stripe test clock is this workspace’s “now”:{' '}
            <strong>{demo.clockTime ? longDate(demo.clockTime) : 'starts at your first checkout'}</strong>
            {advancing && (
              <>
                {' '}
                <Pill tone="warning">advancing…</Pill>
              </>
            )}
          </p>
          <Button variant="primary" busy={busy === 'advance' || advancing} disabled={!subscribed} onClick={onAdvance}>
            {advancing ? 'Stripe is billing…' : 'Advance to next renewal'}
          </Button>
        </div>
        {!subscribed && <p className="muted small">Subscribe first to unlock steps 2 and 3.</p>}
      </div>
    </Card>
  );
}
