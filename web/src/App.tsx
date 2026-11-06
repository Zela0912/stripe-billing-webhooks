import { useCallback, useEffect, useRef, useState } from 'react';
import type { BillingInterval, Notice, PaidPlanId } from '../../shared/billing.ts';
import { api } from './api.ts';
import { CurrentPlan } from './components/CurrentPlan.tsx';
import { DemoControls } from './components/DemoControls.tsx';
import { Events } from './components/Events.tsx';
import { Inbox } from './components/Inbox.tsx';
import { Plans } from './components/Plans.tsx';
import { SettingsNav, TopBar } from './components/Sidebar.tsx';
import { type CheckoutReturn, useDashboard } from './useDashboard.ts';

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
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const now = useNow();

  const showFlash = useCallback((message: string) => {
    setFlash(message);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 5000);
  }, []);

  /** Runs one action at a time, shows its error or a confirmation, then refreshes the dashboard. */
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
        if (success) showFlash(success);
        await refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Something went wrong');
      }
      setBusy(null);
    },
    [refresh, showFlash],
  );

  const onCheckout = (plan: PaidPlanId, interval: BillingInterval) =>
    run(`checkout-${plan}`, () => api.checkout(plan, interval));
  const onPortal = () => run('portal', api.portal);
  const workspace = data?.workspace ?? null;

  return (
    <>
      <TopBar demo={Boolean(workspace?.demo)} />
      <div className="page">
        <SettingsNav workspace={workspace} />

        <main className="content">
          <h1>Billing</h1>

          <div aria-live="polite">
            {checkoutReturn && <CheckoutFlash state={checkoutReturn} onDismiss={dismissCheckoutReturn} />}
            {actionError && (
              <Flash
                notice={{ tone: 'danger', title: 'That didn’t work', message: actionError }}
                onDismiss={() => setActionError(null)}
              />
            )}
            {flash && (
              <Flash notice={{ tone: 'info', title: 'Done', message: flash }} onDismiss={() => setFlash(null)} />
            )}
            {workspace?.notice && <Flash notice={workspace.notice} />}
          </div>

          {!data || !workspace ? (
            <p className="muted" role="status">
              {error ?? 'Loading…'}
            </p>
          ) : (
            <>
              <CurrentPlan
                workspace={workspace}
                busy={busy}
                confirming={checkoutReturn === 'confirming'}
                onEmployees={(n) => run('employees', () => api.setEmployees(n))}
                onPortal={onPortal}
                onRetryPayment={() =>
                  run('retry', api.retryPayment, 'Payment submitted. Your plan updates when Stripe confirms it.')
                }
              />
              <DemoControls
                workspace={workspace}
                busy={busy}
                onAdvance={() =>
                  run(
                    'advance',
                    api.advanceToRenewal,
                    'The test clock is moving. Stripe bills the renewal in a few seconds.',
                  )
                }
                onCard={(card) =>
                  run(
                    'card',
                    () => api.setCard(card),
                    card === 'failing'
                      ? 'Renewals will be charged to the card that declines.'
                      : 'Renewals will be charged to the card that succeeds.',
                  )
                }
              />
              <Plans workspace={workspace} busy={busy} onCheckout={onCheckout} onPortal={onPortal} />
              <Events
                events={data.events}
                busy={busy}
                now={now}
                onReplay={(id) => run(`replay-${id}`, () => api.replay(id), `Event ${id} was queued again.`)}
              />
              <Inbox emails={data.emails} now={now} />
            </>
          )}

          <footer className="footer">
            TidyShift is a fictional company. This page is a demo of a Stripe billing integration by Luka Zelić ·{' '}
            <a href="https://github.com/Zela0912/stripe-billing-webhooks">source code</a>
          </footer>
        </main>
      </div>
    </>
  );
}

function Flash({ notice, onDismiss }: { notice: Notice; onDismiss?: () => void }) {
  return (
    <div className={`flash flash--${notice.tone}`} role={notice.tone === 'danger' ? 'alert' : 'status'}>
      <p>
        <strong>{notice.title}.</strong> {notice.message}
      </p>
      {onDismiss && (
        <button type="button" className="flash__close" aria-label="Dismiss" onClick={onDismiss}>
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
    message: 'We’re waiting for Stripe to confirm it. Your plan changes as soon as it does.',
  },
  confirmed: { tone: 'info', title: 'Payment confirmed', message: 'Your new plan is active.' },
  timed_out: {
    tone: 'warning',
    title: 'Still waiting for Stripe',
    message: 'Your payment hasn’t been confirmed yet. This page will update by itself.',
  },
  canceled: { tone: 'info', title: 'Checkout canceled', message: 'You weren’t charged.' },
};

function CheckoutFlash({ state, onDismiss }: { state: Exclude<CheckoutReturn, null>; onDismiss: () => void }) {
  return <Flash notice={CHECKOUT_MESSAGES[state]} onDismiss={state === 'confirming' ? undefined : onDismiss} />;
}
