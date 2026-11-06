import { useState } from 'react';
import {
  ANNUAL_DISCOUNT,
  type BillingInterval,
  FREE_EMPLOYEE_LIMIT,
  MONTHLY_SEAT_CENTS,
  PAID_PLANS,
  type PaidPlanId,
  PLANS,
  type PlanId,
  seatPriceCents,
  type WorkspaceView,
} from '../../../shared/billing.ts';
import { money } from '../format.ts';
import { Button, Card } from './ui.tsx';

interface Props {
  workspace: WorkspaceView;
  busy: string | null;
  onCheckout: (plan: PaidPlanId, interval: BillingInterval) => void;
  onPortal: () => void;
}

export function PlanPicker({ workspace, busy, onCheckout, onPortal }: Props) {
  const [interval, setInterval] = useState<BillingInterval>(workspace.subscription?.interval ?? 'month');
  const subscribed = workspace.hasActiveSubscription;

  const action = (plan: PlanId) => {
    const isCurrent = plan === workspace.plan && (plan === 'free' || workspace.subscription?.interval === interval);
    if (isCurrent) return <Button disabled>Current plan</Button>;
    if (plan === 'free') {
      return subscribed ? (
        <Button variant="ghost" busy={busy === 'portal'} onClick={onPortal}>
          Cancel in portal
        </Button>
      ) : null;
    }
    // With a subscription, plan changes go through the Customer Portal: Stripe handles the
    // proration, and a second Checkout would create a second subscription.
    if (subscribed) {
      return (
        <Button busy={busy === 'portal'} onClick={onPortal}>
          Switch in portal
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
    <Card
      title="Plans"
      className="area-plans"
      description={`Billed per active employee. You have ${workspace.employees}.`}
      actions={
        <fieldset className="segmented">
          <legend className="sr-only">Billing interval</legend>
          {(['month', 'year'] as const).map((value) => (
            <label key={value} className={interval === value ? 'is-selected' : ''}>
              <input
                type="radio"
                name="interval"
                value={value}
                checked={interval === value}
                onChange={() => setInterval(value)}
              />
              {value === 'month' ? 'Monthly' : `Yearly −${ANNUAL_DISCOUNT * 100}%`}
            </label>
          ))}
        </fieldset>
      }
    >
      <ul className="plans">
        <li className={`plan ${workspace.plan === 'free' ? 'plan--current' : ''}`}>
          <h3>{PLANS.free.name}</h3>
          <p className="plan__tagline">{PLANS.free.tagline}</p>
          <p className="plan__price">
            <strong>$0</strong>
          </p>
          <p className="plan__total">
            {workspace.employees > FREE_EMPLOYEE_LIMIT
              ? `Read-only above ${FREE_EMPLOYEE_LIMIT} employees`
              : 'Free forever'}
          </p>
          <Features plan="free" />
          <div className="plan__action">{action('free')}</div>
        </li>
        {PAID_PLANS.map((plan) => {
          const seat = seatPriceCents(plan, interval);
          const perMonth = interval === 'month' ? seat : seat / 12;
          return (
            <li key={plan} className={`plan ${workspace.plan === plan ? 'plan--current' : ''}`}>
              <h3>
                {PLANS[plan].name}
                {plan === 'pro' && <span className="plan__badge">Popular</span>}
              </h3>
              <p className="plan__tagline">{PLANS[plan].tagline}</p>
              <p className="plan__price">
                <strong>{money(perMonth)}</strong> <span>per employee / month</span>
              </p>
              <p className="plan__total">
                {money(seat * workspace.employees)} per {interval} for {workspace.employees} employees
                {interval === 'year' && (
                  <span className="sr-only">
                    {' '}
                    instead of {money(MONTHLY_SEAT_CENTS[plan] * 12 * workspace.employees)}
                  </span>
                )}
              </p>
              <Features plan={plan} />
              <div className="plan__action">{action(plan)}</div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Features({ plan }: { plan: PlanId }) {
  return (
    <ul className="plan__features">
      {PLANS[plan].features.map((f) => (
        <li key={f}>{f}</li>
      ))}
    </ul>
  );
}
