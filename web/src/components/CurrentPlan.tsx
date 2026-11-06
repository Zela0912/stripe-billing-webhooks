import { PLANS, seatPriceCents, type WorkspaceView } from '../../../shared/billing.ts';
import { longDate, money, statusLabel, statusTone } from '../format.ts';
import { Button, Card, Pill } from './ui.tsx';

interface Props {
  workspace: WorkspaceView;
  busy: string | null;
  onEmployees: (employees: number) => void;
  onPortal: () => void;
  onRetryPayment: () => void;
}

export function CurrentPlan({ workspace, busy, onEmployees, onPortal, onRetryPayment }: Props) {
  const sub = workspace.subscription;
  const live = workspace.hasActiveSubscription && sub?.plan && sub.interval;
  const total = live && sub.plan && sub.interval ? seatPriceCents(sub.plan, sub.interval) * sub.quantity : 0;

  return (
    <Card
      title="Current plan"
      className="area-current"
      actions={
        <>
          {workspace.canRetryPayment && (
            <Button variant="primary" busy={busy === 'retry'} onClick={onRetryPayment}>
              Pay now
            </Button>
          )}
          {workspace.hasActiveSubscription && (
            <Button busy={busy === 'portal'} onClick={onPortal}>
              Manage billing
            </Button>
          )}
        </>
      }
    >
      <div className="plan-summary">
        <div className="plan-summary__name">
          <span className="plan-summary__plan">{PLANS[workspace.plan].name}</span>
          {sub && workspace.hasActiveSubscription && (
            <Pill tone={statusTone(sub.status)}>{statusLabel(sub.status)}</Pill>
          )}
          {workspace.access === 'read_only' && <Pill tone="danger">Read-only</Pill>}
        </div>

        <dl className="facts">
          <div>
            <dt>Employees</dt>
            <dd>
              <fieldset className="stepper">
                <legend className="sr-only">Active employees</legend>
                <button
                  type="button"
                  aria-label="Remove an employee"
                  disabled={workspace.employees <= 1 || busy === 'employees'}
                  onClick={() => onEmployees(workspace.employees - 1)}
                >
                  −
                </button>
                <output aria-live="polite">{workspace.employees}</output>
                <button
                  type="button"
                  aria-label="Add an employee"
                  disabled={workspace.employees >= 500 || busy === 'employees'}
                  onClick={() => onEmployees(workspace.employees + 1)}
                >
                  +
                </button>
              </fieldset>
            </dd>
          </div>
          <div>
            <dt>{live ? `Billed per ${sub.interval}` : 'Price'}</dt>
            <dd>
              {live ? (
                <>
                  <strong>{money(total)}</strong>
                  <span className="muted">
                    {' '}
                    · {sub.quantity} × {money(sub.plan && sub.interval ? seatPriceCents(sub.plan, sub.interval) : 0)}
                  </span>
                </>
              ) : (
                <strong>Free</strong>
              )}
            </dd>
          </div>
          {live && sub.currentPeriodEnd && (
            <div>
              <dt>{sub.cancelAtPeriodEnd ? 'Ends on' : 'Renews on'}</dt>
              <dd>{longDate(sub.currentPeriodEnd)}</dd>
            </div>
          )}
          <div>
            <dt>Billing email</dt>
            <dd className="break">{workspace.billingEmail}</dd>
          </div>
        </dl>
        {live && sub.quantity !== workspace.employees && (
          <p className="muted small" role="status">
            Updating the seat count in Stripe…
          </p>
        )}
      </div>
    </Card>
  );
}
