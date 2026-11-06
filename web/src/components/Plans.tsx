import { useState } from 'react';
import {
  type BillingInterval,
  FREE_EMPLOYEE_LIMIT,
  PAID_PLANS,
  type PaidPlanId,
  PLANS,
  type PlanId,
  seatPriceCents,
  type WorkspaceView,
} from '../../../shared/billing.ts';
import { money } from '../format.ts';
import { Button, Section } from './ui.tsx';

interface Props {
  workspace: WorkspaceView;
  busy: string | null;
  onCheckout: (plan: PaidPlanId, interval: BillingInterval) => void;
  onPortal: () => void;
}

export function Plans({ workspace, busy, onCheckout, onPortal }: Props) {
  const [interval, setInterval] = useState<BillingInterval>(workspace.subscription?.interval ?? 'month');
  const subscribed = workspace.hasActiveSubscription;
  const n = workspace.employees;

  const isCurrent = (plan: PlanId) =>
    plan === workspace.plan && (plan === 'free' || workspace.subscription?.interval === interval);

  const action = (plan: PlanId) => {
    if (isCurrent(plan)) return <span className="plan__current">Your current plan</span>;
    if (plan === 'free') {
      return subscribed ? (
        <Button busy={busy === 'portal'} onClick={onPortal}>
          Downgrade
        </Button>
      ) : null;
    }
    // With a subscription, changes go through the Customer Portal: Stripe prorates them, and a
    // second Checkout would create a second subscription.
    if (subscribed) {
      return (
        <Button busy={busy === 'portal'} onClick={onPortal}>
          Switch to {PLANS[plan].name}
        </Button>
      );
    }
    return (
      <Button variant="primary" busy={busy === `checkout-${plan}`} onClick={() => onCheckout(plan, interval)}>
        Upgrade to {PLANS[plan].name}
      </Button>
    );
  };

  return (
    <Section
      id="plans"
      title="Change plan"
      actions={
        <fieldset className="radios">
          <legend className="sr-only">Billing interval</legend>
          <label>
            <input type="radio" name="interval" checked={interval === 'month'} onChange={() => setInterval('month')} />
            Monthly
          </label>
          <label>
            <input type="radio" name="interval" checked={interval === 'year'} onChange={() => setInterval('year')} />
            Yearly (save 20%)
          </label>
        </fieldset>
      }
      description={`Prices are per active employee. Totals are for your ${n} employees.`}
    >
      <div className="plans">
        {(['free', ...PAID_PLANS] as PlanId[]).map((plan) => {
          const seat = plan === 'free' ? 0 : seatPriceCents(plan, interval);
          return (
            <div key={plan} className={`plan ${isCurrent(plan) ? 'is-current' : ''}`}>
              <h3>{PLANS[plan].name}</h3>
              <p className="muted small">{PLANS[plan].tagline}</p>
              <p className="plan__price">
                {plan === 'free' ? (
                  '$0'
                ) : (
                  <>
                    {money(interval === 'month' ? seat : seat / 12, { exact: true })}
                    <span className="muted"> / employee / month</span>
                  </>
                )}
              </p>
              <p className="muted small">
                {plan === 'free'
                  ? n > FREE_EMPLOYEE_LIMIT
                    ? `Read-only above ${FREE_EMPLOYEE_LIMIT} employees`
                    : `Up to ${FREE_EMPLOYEE_LIMIT} employees`
                  : `${money(seat * n, { exact: true })} per ${interval}`}
              </p>
              <ul>
                {PLANS[plan].features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <div className="plan__action">{action(plan)}</div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
