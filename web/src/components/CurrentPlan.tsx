import { FREE_EMPLOYEE_LIMIT, PLANS, seatPriceCents, type WorkspaceView } from '../../../shared/billing.ts';
import { longDate, money, statusLabel, statusTone } from '../format.ts';
import { Button, Label, Section } from './ui.tsx';

interface Props {
  workspace: WorkspaceView;
  busy: string | null;
  confirming: boolean;
  onEmployees: (employees: number) => void;
  onPortal: () => void;
  onRetryPayment: () => void;
}

export function CurrentPlan({ workspace, busy, confirming, onEmployees, onPortal, onRetryPayment }: Props) {
  const sub = workspace.subscription;
  const paid = workspace.hasActiveSubscription && sub?.plan && sub.interval ? sub : null;
  const seat = paid?.plan && paid.interval ? seatPriceCents(paid.plan, paid.interval) : 0;
  const total = seat * (paid?.quantity ?? 0);
  const intervalWord = paid?.interval === 'year' ? 'year' : 'month';

  return (
    <Section
      id="current-plan"
      title="Current plan"
      actions={
        <>
          {workspace.canRetryPayment && (
            <Button variant="primary" busy={busy === 'retry'} onClick={onRetryPayment}>
              Pay now
            </Button>
          )}
          {workspace.hasActiveSubscription && (
            <Button busy={busy === 'portal'} onClick={onPortal}>
              Manage in Stripe
            </Button>
          )}
        </>
      }
    >
      <dl className="rows">
        <div className="row">
          <dt>Plan</dt>
          <dd>
            <strong>{PLANS[workspace.plan].name}</strong>
            {paid && <Label tone={statusTone(paid.status)}>{statusLabel(paid.status)}</Label>}
            {workspace.access === 'read_only' && <Label tone="danger">Read-only</Label>}
            {confirming && <span className="muted">Confirming payment…</span>}
          </dd>
        </div>

        <div className="row">
          <dt>Price</dt>
          <dd>
            {paid ? (
              <>
                {money(total, { exact: true })} per {intervalWord}
                <span className="muted">
                  {' '}
                  ({paid.quantity} employees × {money(seat, { exact: true })})
                </span>
              </>
            ) : (
              <>
                Free <span className="muted">(up to {FREE_EMPLOYEE_LIMIT} employees)</span>
              </>
            )}
          </dd>
        </div>

        <div className="row">
          <dt>
            <label htmlFor="employees">Active employees</label>
          </dt>
          <dd>
            <span className="stepper">
              <button
                type="button"
                aria-label="Remove an employee"
                disabled={workspace.employees <= 1 || busy === 'employees'}
                onClick={() => onEmployees(workspace.employees - 1)}
              >
                −
              </button>
              <output id="employees" aria-live="polite">
                {workspace.employees}
              </output>
              <button
                type="button"
                aria-label="Add an employee"
                disabled={workspace.employees >= 500 || busy === 'employees'}
                onClick={() => onEmployees(workspace.employees + 1)}
              >
                +
              </button>
            </span>
            <span className="muted small">
              {paid
                ? paid.quantity === workspace.employees
                  ? 'Changes are prorated on the next invoice.'
                  : 'Updating Stripe…'
                : workspace.employees > FREE_EMPLOYEE_LIMIT
                  ? `${workspace.employees - FREE_EMPLOYEE_LIMIT} over the Free limit.`
                  : `Free covers ${FREE_EMPLOYEE_LIMIT}.`}
            </span>
          </dd>
        </div>

        {paid?.currentPeriodEnd && (
          <div className="row">
            <dt>{paid.cancelAtPeriodEnd ? 'Ends on' : 'Next invoice'}</dt>
            <dd>
              {paid.cancelAtPeriodEnd
                ? longDate(paid.currentPeriodEnd)
                : `${money(total, { exact: true })} on ${longDate(paid.currentPeriodEnd)}`}
            </dd>
          </div>
        )}

        {paid && (
          <div className="row">
            <dt>Payment method</dt>
            <dd>
              {workspace.demo ? (
                <>
                  Visa ending in {workspace.demo.card === 'failing' ? '0341' : '4242'}
                  {workspace.demo.card === 'failing' && <span className="muted"> (test card that declines)</span>}
                </>
              ) : (
                'Card on file in Stripe'
              )}
            </dd>
          </div>
        )}

        <div className="row">
          <dt>Billing email</dt>
          <dd className="break">{workspace.billingEmail}</dd>
        </div>
      </dl>
    </Section>
  );
}
