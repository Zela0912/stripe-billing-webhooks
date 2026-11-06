import { CreditCard, Mail, Minus, Plus, Receipt } from 'lucide-react';
import { FREE_EMPLOYEE_LIMIT, PLANS, seatPriceCents, type WorkspaceView } from '../../../shared/billing.ts';
import { longDate, money, statusLabel, statusTone } from '../format.ts';
import { Badge, Button } from './ui.tsx';

interface Props {
  workspace: WorkspaceView;
  busy: string | null;
  confirming: boolean;
  onEmployees: (employees: number) => void;
  onPortal: () => void;
  onRetryPayment: () => void;
}

const METER_MAX = 20;

export function PlanOverview({ workspace, busy, confirming, onEmployees, onPortal, onRetryPayment }: Props) {
  const sub = workspace.subscription;
  const paid = workspace.hasActiveSubscription && sub?.plan && sub.interval ? sub : null;
  const seat = paid?.plan && paid.interval ? seatPriceCents(paid.plan, paid.interval) : 0;
  const total = seat * (paid?.quantity ?? 0);
  const syncingSeats = paid !== null && paid.quantity !== workspace.employees;
  const meterMax = Math.max(METER_MAX, workspace.employees);

  return (
    <section className="overview" aria-labelledby="overview-title">
      <div className="overview__main">
        <p className="eyebrow" id="overview-title">
          Current plan
        </p>
        <div className="overview__plan">
          <span className="overview__plan-name">{PLANS[workspace.plan].name}</span>
          {paid && (
            <Badge tone={statusTone(paid.status)} dot>
              {statusLabel(paid.status)}
            </Badge>
          )}
          {workspace.access === 'read_only' && (
            <Badge tone="danger" dot>
              Read-only
            </Badge>
          )}
          {confirming && <Badge tone="info">Confirming payment…</Badge>}
        </div>

        <p className="overview__price">
          {paid ? (
            <>
              <strong>{money(total)}</strong>
              <span>
                per {paid.interval} · {paid.quantity} × {money(seat)}
              </span>
            </>
          ) : (
            <>
              <strong>$0</strong>
              <span>Free forever, up to {FREE_EMPLOYEE_LIMIT} employees</span>
            </>
          )}
        </p>

        <dl className="overview__facts">
          <div>
            <dt>
              <Receipt size={14} aria-hidden="true" /> {paid?.cancelAtPeriodEnd ? 'Ends on' : 'Next invoice'}
            </dt>
            <dd>
              {paid?.currentPeriodEnd
                ? paid.cancelAtPeriodEnd
                  ? longDate(paid.currentPeriodEnd)
                  : `${money(total, { exact: true })} on ${longDate(paid.currentPeriodEnd)}`
                : 'None'}
            </dd>
          </div>
          <div>
            <dt>
              <CreditCard size={14} aria-hidden="true" /> Payment method
            </dt>
            <dd>
              {!paid ? (
                'None yet'
              ) : workspace.demo ? (
                <span className="card-chip">
                  <span className="card-chip__brand">VISA</span>
                  •••• {workspace.demo.card === 'failing' ? '0341' : '4242'}
                  {workspace.demo.card === 'failing' && <Badge tone="danger">declines</Badge>}
                </span>
              ) : (
                'Managed in Stripe'
              )}
            </dd>
          </div>
          <div>
            <dt>
              <Mail size={14} aria-hidden="true" /> Billing email
            </dt>
            <dd className="break">{workspace.billingEmail}</dd>
          </div>
        </dl>

        <div className="overview__actions">
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
          {!workspace.hasActiveSubscription && (
            <a className="button button--primary button--md" href="#plans">
              Choose a plan
            </a>
          )}
        </div>
      </div>

      <div className="overview__seats">
        <div className="seats__head">
          <p className="eyebrow">Active employees</p>
          <fieldset className="stepper">
            <legend className="sr-only">Active employees</legend>
            <button
              type="button"
              aria-label="Remove an employee"
              disabled={workspace.employees <= 1 || busy === 'employees'}
              onClick={() => onEmployees(workspace.employees - 1)}
            >
              <Minus size={14} aria-hidden="true" />
            </button>
            <output aria-live="polite">{workspace.employees}</output>
            <button
              type="button"
              aria-label="Add an employee"
              disabled={workspace.employees >= 500 || busy === 'employees'}
              onClick={() => onEmployees(workspace.employees + 1)}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
          </fieldset>
        </div>

        <div
          className={`meter ${!paid && workspace.employees > FREE_EMPLOYEE_LIMIT ? 'meter--over' : ''}`}
          role="img"
          aria-label={`${workspace.employees} employees; the Free plan covers ${FREE_EMPLOYEE_LIMIT}`}
        >
          <div className="meter__fill" style={{ width: `${(workspace.employees / meterMax) * 100}%` }} />
          <div className="meter__limit" style={{ left: `${(FREE_EMPLOYEE_LIMIT / meterMax) * 100}%` }}>
            <span>Free limit</span>
          </div>
        </div>

        <dl className="summary">
          {paid ? (
            <>
              <div>
                <dt>
                  {PLANS[workspace.plan].name}, billed {paid.interval === 'month' ? 'monthly' : 'yearly'}
                </dt>
                <dd>{money(seat, { exact: true })}</dd>
              </div>
              <div>
                <dt>Employees</dt>
                <dd>× {paid.quantity}</dd>
              </div>
              <div className="summary__total">
                <dt>Total per {paid.interval}</dt>
                <dd>{money(total, { exact: true })}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>Free plan</dt>
                <dd>$0.00</dd>
              </div>
              <div>
                <dt>Included employees</dt>
                <dd>{FREE_EMPLOYEE_LIMIT}</dd>
              </div>
              <div className="summary__total">
                <dt>Pro for your team</dt>
                <dd>{money(seatPriceCents('pro', 'month') * workspace.employees)}/mo</dd>
              </div>
            </>
          )}
        </dl>

        <p className="seats__note">
          {syncingSeats
            ? 'Updating the seat count in Stripe…'
            : paid
              ? 'Billed per employee. Changes are prorated and confirmed by webhook.'
              : workspace.employees > FREE_EMPLOYEE_LIMIT
                ? `${workspace.employees - FREE_EMPLOYEE_LIMIT} over the Free limit. Upgrade, or remove employees.`
                : `${FREE_EMPLOYEE_LIMIT - workspace.employees} more employees fit on Free.`}
        </p>
      </div>
    </section>
  );
}
