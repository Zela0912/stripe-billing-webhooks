import { useCallback, useState } from 'react';
import type { BillingInterval, Notice, PaidPlanId } from '../../shared/billing.ts';
import { api } from './api.ts';
import { CurrentPlan } from './components/CurrentPlan.tsx';
import { DemoPanel } from './components/DemoPanel.tsx';
import { EventLog, Outbox } from './components/EventLog.tsx';
import { PlanPicker } from './components/PlanPicker.tsx';
import { type CheckoutReturn, useDashboard } from './useDashboard.ts';

export function App() {
  const { data, error, refresh, checkoutReturn, dismissCheckoutReturn } = useDashboard();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /** Runs one action at a time, shows its error, then refreshes the dashboard. */
  const run = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      setBusy(key);
      setActionError(null);
      try {
        const result = await action();
        if (result && typeof result === 'object' && 'url' in result && typeof result.url === 'string') {
          window.location.assign(result.url); // Stripe Checkout or the Customer Portal
          return;
        }
        await refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Something went wrong');
      }
      setBusy(null);
    },
    [refresh],
  );

  const onCheckout = (plan: PaidPlanId, interval: BillingInterval) =>
    run(`checkout-${plan}`, () => api.checkout(plan, interval));
  const onPortal = () => run('portal', api.portal);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          <div className="brand">
            <img src="/favicon.svg" alt="" width="28" height="28" />
            <span className="brand__name">TidyShift</span>
            <nav aria-label="Breadcrumb" className="crumbs">
              <span>Settings</span>
              <span aria-hidden="true">›</span>
              <span aria-current="page">Billing</span>
            </nav>
          </div>
          <div className="topbar__right">
            {data?.workspace.demo && <span className="sandbox">Stripe sandbox</span>}
            {data && <span className="workspace-name">{data.workspace.name}</span>}
          </div>
        </div>
      </header>

      <main className="page">
        <div className="page__intro">
          <h1>Billing</h1>
          <p>
            Subscriptions with Stripe Checkout and the Customer Portal. Access changes only when a verified webhook says
            so.
          </p>
        </div>

        <div aria-live="polite">
          {checkoutReturn && <CheckoutBanner state={checkoutReturn} onDismiss={dismissCheckoutReturn} />}
          {actionError && (
            <NoticeBanner
              notice={{ tone: 'danger', title: 'That didn’t work', message: actionError }}
              onDismiss={() => setActionError(null)}
            />
          )}
          {data?.workspace.notice && <NoticeBanner notice={data.workspace.notice} />}
        </div>

        {!data ? (
          <p className="loading">{error ?? 'Loading billing…'}</p>
        ) : (
          <div className="layout">
            <div className="layout__main">
              <CurrentPlan
                workspace={data.workspace}
                busy={busy}
                onEmployees={(n) => run('employees', () => api.setEmployees(n))}
                onPortal={onPortal}
                onRetryPayment={() => run('retry', api.retryPayment)}
              />
              <PlanPicker workspace={data.workspace} busy={busy} onCheckout={onCheckout} onPortal={onPortal} />
              <EventLog events={data.events} busy={busy} onReplay={(id) => run(`replay-${id}`, () => api.replay(id))} />
            </div>
            <aside className="layout__side">
              <DemoPanel
                workspace={data.workspace}
                busy={busy}
                onAdvance={() => run('advance', api.advanceToRenewal)}
                onCard={(card) => run('card', () => api.setCard(card))}
              />
              <Outbox emails={data.emails} />
            </aside>
          </div>
        )}
      </main>

      <footer className="footer">
        Demo by Luka Zelić · Fictional company ·{' '}
        <a href="https://github.com/Zela0912/stripe-billing-webhooks">Source on GitHub</a>
      </footer>
    </div>
  );
}

function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss?: () => void }) {
  return (
    <div className={`notice notice--${notice.tone}`} role={notice.tone === 'danger' ? 'alert' : 'status'}>
      <div>
        <strong>{notice.title}.</strong> {notice.message}
      </div>
      {onDismiss && (
        <button type="button" className="notice__close" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  );
}

const CHECKOUT_MESSAGES: Record<Exclude<CheckoutReturn, null>, Notice> = {
  confirming: {
    tone: 'info',
    title: 'Confirming your payment',
    message: 'Waiting for Stripe’s webhook. The plan unlocks when the payment is verified, not when the page loads.',
  },
  confirmed: { tone: 'info', title: 'Payment confirmed', message: 'The webhook arrived and your plan is active.' },
  timed_out: {
    tone: 'warning',
    title: 'Still waiting for Stripe',
    message: 'The payment hasn’t been confirmed yet. This page updates on its own as soon as it is.',
  },
  canceled: { tone: 'info', title: 'Checkout canceled', message: 'Nothing was charged.' },
};

function CheckoutBanner({ state, onDismiss }: { state: Exclude<CheckoutReturn, null>; onDismiss: () => void }) {
  return <NoticeBanner notice={CHECKOUT_MESSAGES[state]} onDismiss={state === 'confirming' ? undefined : onDismiss} />;
}
