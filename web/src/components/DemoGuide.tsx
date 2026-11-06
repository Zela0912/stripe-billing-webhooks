import { CalendarClock, Check, Copy, FastForward, FlaskConical } from 'lucide-react';
import { useState } from 'react';
import type { EmailView, WorkspaceView } from '../../../shared/billing.ts';
import { longDate } from '../format.ts';
import { Badge, Button, Kbd } from './ui.tsx';

interface Props {
  workspace: WorkspaceView;
  emails: EmailView[];
  busy: string | null;
  onAdvance: () => void;
  onCard: (card: 'working' | 'failing') => void;
  onRetryPayment: () => void;
}

/** A guided tour: subscribe, break the next renewal, recover. Each step ticks itself off. */
export function DemoGuide({ workspace, emails, busy, onAdvance, onCard, onRetryPayment }: Props) {
  const demo = workspace.demo;
  const [copied, setCopied] = useState(false);
  if (!demo) return null;

  const status = workspace.subscription?.status;
  const subscribed = workspace.hasActiveSubscription;
  const failed = status === 'past_due' || status === 'unpaid';
  const lastFailure = emails.find((m) => m.subject.startsWith('Payment failed'));
  const recovered =
    !failed &&
    lastFailure !== undefined &&
    emails.some((m) => m.subject.startsWith('Receipt') && m.id > lastFailure.id);
  const advancing = demo.clockStatus === 'advancing';

  const steps = [
    { done: subscribed, title: 'Subscribe with a test card' },
    { done: demo.card === 'failing' || failed || recovered, title: 'Make the next renewal fail' },
    { done: failed || recovered, title: 'Jump to the renewal date' },
    { done: recovered, title: 'Recover the payment' },
  ];
  const current = steps.findIndex((s) => !s.done);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText('4242424242424242');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the number is on screen anyway.
    }
  };

  return (
    <section className="guide" aria-labelledby="guide-title">
      <div className="guide__head">
        <span className="guide__icon" aria-hidden="true">
          <FlaskConical size={16} />
        </span>
        <div>
          <h2 id="guide-title">Try the failure cases</h2>
          <p>Stripe sandbox and a test clock. No real money moves.</p>
        </div>
      </div>

      <div className="clock">
        <CalendarClock size={15} aria-hidden="true" />
        <span>Simulated date</span>
        <strong>{demo.clockTime ? longDate(demo.clockTime) : 'starts at checkout'}</strong>
        {advancing && <Badge tone="warning">advancing…</Badge>}
      </div>

      <ol className="steps">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className={`step ${step.done ? 'is-done' : ''} ${i === current ? 'is-current' : ''}`}
            aria-current={i === current ? 'step' : undefined}
          >
            <span className="step__marker" aria-hidden="true">
              {step.done ? <Check size={13} /> : i + 1}
            </span>
            <div className="step__content">
              <h3>
                {step.title}
                {step.done && <span className="sr-only"> (done)</span>}
              </h3>
              {i === 0 && (
                <p>
                  Pick a plan and pay with{' '}
                  <button type="button" className="copy" onClick={copy} aria-label="Copy test card number">
                    <Kbd>4242 4242 4242 4242</Kbd>
                    {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                  </button>
                  , any future date and CVC. For 3D Secure: <Kbd>4000 0027 6000 3184</Kbd>.
                </p>
              )}
              {i === 1 && (
                <>
                  <p>Renewals will be charged to Stripe’s test card that always declines.</p>
                  <fieldset className="tabs tabs--block" disabled={!subscribed || busy === 'card'}>
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
                        {card === 'working' ? '•••• 4242 works' : '•••• 0341 declines'}
                      </label>
                    ))}
                  </fieldset>
                </>
              )}
              {i === 2 && (
                <>
                  <p>Moves this workspace’s clock past the renewal, so Stripe bills it now.</p>
                  <Button
                    variant={i === current ? 'primary' : 'secondary'}
                    size="sm"
                    icon={<FastForward size={14} aria-hidden="true" />}
                    busy={busy === 'advance' || advancing}
                    disabled={!subscribed}
                    onClick={onAdvance}
                  >
                    {advancing ? 'Stripe is billing…' : 'Advance to next renewal'}
                  </Button>
                </>
              )}
              {i === 3 && (
                <>
                  <p>Switch back to the working card, then pay the open invoice.</p>
                  <Button
                    variant={i === current ? 'primary' : 'secondary'}
                    size="sm"
                    busy={busy === 'retry'}
                    disabled={!workspace.canRetryPayment || demo.card === 'failing'}
                    onClick={onRetryPayment}
                  >
                    Pay now
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
