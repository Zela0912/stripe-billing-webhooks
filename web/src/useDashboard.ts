import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dashboard } from '../../shared/billing.ts';
import { api } from './api.ts';

const POLL_MS = 2500;
/** After returning from Checkout, how long to wait for the webhook before giving up. */
const CONFIRM_TIMEOUT_MS = 60_000;
const CONFIRMED_VISIBLE_MS = 6_000;

export type CheckoutReturn = 'confirming' | 'confirmed' | 'timed_out' | 'canceled' | null;

/**
 * Loads the billing dashboard and keeps it fresh by polling while the tab is visible, so
 * webhook results show up on their own. Polling is simple and enough for a settings page;
 * Server-Sent Events would be the next step for a busier screen.
 */
export function useDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutReturn, setCheckoutReturn] = useState<CheckoutReturn>(() => readCheckoutParam());
  const confirmStarted = useRef(Date.now());

  const refresh = useCallback(async () => {
    try {
      const next = await api.dashboard();
      setData(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Coming back from Checkout: the page waits for the webhook, it doesn't trust the redirect.
  useEffect(() => {
    if (checkoutReturn !== 'confirming' || !data) return;
    if (data.workspace.subscription && data.workspace.hasActiveSubscription) setCheckoutReturn('confirmed');
    else if (Date.now() - confirmStarted.current > CONFIRM_TIMEOUT_MS) setCheckoutReturn('timed_out');
  }, [data, checkoutReturn]);

  // The confirmation is good news; it shouldn't stay on screen above later notices.
  useEffect(() => {
    if (checkoutReturn !== 'confirmed') return;
    const timer = setTimeout(() => setCheckoutReturn(null), CONFIRMED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [checkoutReturn]);

  const dismissCheckoutReturn = useCallback(() => setCheckoutReturn(null), []);

  return { data, error, refresh, checkoutReturn, dismissCheckoutReturn };
}

function readCheckoutParam(): CheckoutReturn {
  const params = new URLSearchParams(window.location.search);
  const value = params.get('checkout');
  if (!value) return null;
  // Clean the URL so a reload doesn't show the message again.
  params.delete('checkout');
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  return value === 'success' ? 'confirming' : value === 'canceled' ? 'canceled' : null;
}
