import { Check } from 'lucide-react';
import { useState } from 'react';
import {
  ANNUAL_DISCOUNT,
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
import { Badge, Button, Section, Switch } from './ui.tsx';

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
    if (isCurrent(plan)) return <Button disabled>Current plan</Button>;
    if (plan === 'free') {
      return subscribed ? (
        <Button variant="ghost" busy={busy === 'portal'} onClick={onPortal}>
          Downgrade in portal
        </Button>
      ) : (
        <Button disabled>Included</Button>
      );
    }
    // With a subscription, changes go through the Customer Portal: Stripe prorates them, and a
    // second Checkout would create a second subscription.
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
    <Section
      id="plans"
      title="Plans"
      description={`Billed per active employee. Prices for your ${n} employees.`}
      actions={
        <Switch
          checked={interval === 'year'}
          onChange={(yearly) => setInterval(yearly ? 'year' : 'month')}
          label={
            <>
              Billed yearly <Badge tone="brand">−{ANNUAL_DISCOUNT * 100}%</Badge>
            </>
          }
        />
      }
    >
      <ul className="plans">
        {(['free', ...PAID_PLANS] as PlanId[]).map((plan) => {
          const seat = plan === 'free' ? 0 : seatPriceCents(plan, interval);
          const perMonth = interval === 'month' ? seat : seat / 12;
          return (
            <li
              key={plan}
              className={`plan ${isCurrent(plan) ? 'is-current' : ''} ${plan === 'pro' ? 'is-featured' : ''}`}
            >
              <div className="plan__head">
                <h3>{PLANS[plan].name}</h3>
                {plan === 'pro' && <Badge tone="brand">Popular</Badge>}
                {isCurrent(plan) && <Badge tone="success">Current</Badge>}
              </div>
              <p className="plan__tagline">{PLANS[plan].tagline}</p>
              <p className="plan__price">
                <strong>{money(perMonth)}</strong>
                <span>{plan === 'free' ? 'forever' : 'per employee / month'}</span>
              </p>
              <p className="plan__total">
                {plan === 'free'
                  ? n > FREE_EMPLOYEE_LIMIT
                    ? `Read-only above ${FREE_EMPLOYEE_LIMIT} employees`
                    : `Covers your ${n} employees`
                  : `${money(seat * n)} billed per ${interval}`}
              </p>
              <div className="plan__action">{action(plan)}</div>
              <ul className="plan__features">
                {PLANS[plan].features.map((f) => (
                  <li key={f}>
                    <Check size={15} className="plan__check" aria-hidden="true" />
                    {f}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
