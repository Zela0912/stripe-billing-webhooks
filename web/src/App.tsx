import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BillingInterval, Notice, PaidPlanId } from '../../shared/billing.ts';
import { api } from './api.ts';
import { DemoGuide } from './components/DemoGuide.tsx';
import { Events } from './components/Events.tsx';
import { Inbox } from './components/Inbox.tsx';
import { Pipeline } from './components/Pipeline.tsx';
import { PlanOverview } from './components/PlanOverview.tsx';
import { Plans } from './components/Plans.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { Badge } from './components/ui.tsx';
import { type CheckoutReturn, useDashboard } from './useDashboard.ts';

interface Toast {
  id: number;
  message: string;
}

/** Re-renders every few seconds so "12s ago" stays true. */
function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function App() {
  const { data, error, refresh, checkoutReturn, dismissCheckoutReturn } = useDashboard();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const now = useNow();

  const toast = useCallback((message: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  /** Runs one action at a time, shows its error or a toast, then refreshes the dashboard. */
  const run = useCallback(
    async (key: string, action: () => Promise<unknown>, success?: string) => {
      setBusy(key);
      setActionError(null);
      try {
        const result = await action();
        if (result && typeof result === 'object' && 'url' in result && typeof result.url === 'string') {
          window.location.assign(result.url); // Stripe Checkout or the Customer Portal
          return;
        }
        if (success) toast(success);
        await refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Something went wrong');
      }
      setBusy(null);
    },
    [refresh, toast],
  );

  const onCheckout = (plan: PaidPlanId, interval: BillingInterval) =>
    run(`checkout-${plan}`, () => api.checkout(plan, interval));
  const onPortal = () => run('portal', api.portal);
  const onRetryPayment = () =>
    run('retry', api.retryPayment, 'Payment sent. Access updates when Stripe’s webhook arrives.');

  const workspace = data?.workspace ?? null;

  return (
    <div className="shell">
      <Sidebar workspace={workspace} />

      <div className="main">
        <header className="mobilebar">
          <img src="/favicon.svg" alt="" width="24" height="24" />
          <span className="mobilebar__name">TidyShift</span>
          {workspace && <span className="mobilebar__workspace">{workspace.name}</span>}
        </header>

        <main className="content">
          <div className="page-head">
            <div>
              <nav aria-label="Breadcrumb" className="crumbs">
                <span>Settings</span>
                <span aria-hidden="true">/</span>
                <span aria-current="page">Billing</span>
              </nav>
              <h1>Billing</h1>
              <p>Manage your plan, seats and payments. Access changes only when Stripe confirms it with a webhook.</p>
            </div>
            {workspace?.demo && (
              <Badge tone="warning" dot>
                Sandbox
              </Badge>
            )}
          </div>

          <div className="notices" aria-live="polite">
            {checkoutReturn && <CheckoutBanner state={checkoutReturn} onDismiss={dismissCheckoutReturn} />}
            {actionError && (
              <NoticeBanner
                notice={{ tone: 'danger', title: 'That didn’t work', message: actionError }}
                onDismiss={() => setActionError(null)}
              />
            )}
            {workspace?.notice && <NoticeBanner notice={workspace.notice} />}
          </div>

          {!data || !workspace ? (
            <div className="loading" role="status">
              {error ?? (
                <>
                  <LoaderCircle className="spin" size={16} aria-hidden="true" /> Loading billing…
                </>
              )}
            </div>
          ) : (
            <div className="layout">
              <div className="layout__main">
                <PlanOverview
                  workspace={workspace}
                  busy={busy}
                  confirming={checkoutReturn === 'confirming'}
                  onEmployees={(n) => run('employees', () => api.setEmployees(n))}
                  onPortal={onPortal}
                  onRetryPayment={onRetryPayment}
                />
                <Pipeline events={data.events} now={now} />
                <Plans workspace={workspace} busy={busy} onCheckout={onCheckout} onPortal={onPortal} />
                <Events
                  events={data.events}
                  busy={busy}
                  now={now}
                  onReplay={(id) => run(`replay-${id}`, () => api.replay(id), 'Event re-queued. Watch it run again.')}
                />
              </div>
              <aside className="layout__side" aria-label="Demo">
                <DemoGuide
                  workspace={workspace}
                  emails={data.emails}
                  busy={busy}
                  onAdvance={() =>
                    run(
                      'advance',
                      api.advanceToRenewal,
                      'Clock is moving. Stripe will bill the renewal in a few seconds.',
                    )
                  }
                  onCard={(card) =>
                    run(
                      'card',
                      () => api.setCard(card),
                      card === 'failing' ? 'Renewals now go to a card that declines.' : 'Back to the working card.',
                    )
                  }
                  onRetryPayment={onRetryPayment}
                />
                <Inbox emails={data.emails} now={now} />
              </aside>
            </div>
          )}

          <footer className="footer">
            Built by Luka Zelić · Stripe Checkout, Customer Portal and webhooks ·{' '}
            <a href="https://github.com/Zela0912/stripe-billing-webhooks">Source</a>
          </footer>
        </main>
      </div>

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <CircleCheck size={16} className="toast__icon" aria-hidden="true" />
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

const NOTICE_ICONS = {
  info: <Info size={18} aria-hidden="true" />,
  warning: <TriangleAlert size={18} aria-hidden="true" />,
  danger: <CircleAlert size={18} aria-hidden="true" />,
};

function NoticeBanner({ notice, onDismiss, busy = false }: { notice: Notice; onDismiss?: () => void; busy?: boolean }) {
  return (
    <div className={`notice notice--${notice.tone}`} role={notice.tone === 'danger' ? 'alert' : 'status'}>
      <span className="notice__icon">
        {busy ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : NOTICE_ICONS[notice.tone]}
      </span>
      <div className="notice__text">
        <strong>{notice.title}.</strong> {notice.message}
      </div>
      {onDismiss && (
        <button type="button" className="notice__close" aria-label="Dismiss" onClick={onDismiss}>
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

const CHECKOUT_MESSAGES: Record<Exclude<CheckoutReturn, null>, Notice> = {
  confirming: {
    tone: 'info',
    title: 'Confirming your payment',
    message: 'Waiting for Stripe’s webhook. The plan unlocks when the payment is verified, not when this page loads.',
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
  return (
    <NoticeBanner
      notice={CHECKOUT_MESSAGES[state]}
      busy={state === 'confirming'}
      onDismiss={state === 'confirming' ? undefined : onDismiss}
    />
  );
}
