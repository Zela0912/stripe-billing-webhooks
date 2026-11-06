import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Dashboard, WorkspaceView } from '../../shared/billing.ts';
import { App } from './App.tsx';

function dashboard(workspace: Partial<WorkspaceView> = {}, extra: Partial<Dashboard> = {}): Dashboard {
  return {
    workspace: {
      id: 'ws_1',
      name: 'Harbor Coffee',
      billingEmail: 'billing@harborcoffee.example',
      employees: 12,
      plan: 'free',
      access: 'read_only',
      notice: { tone: 'danger', title: 'Over the Free plan limit', message: 'Upgrade or remove employees.' },
      subscription: null,
      hasActiveSubscription: false,
      canRetryPayment: false,
      demo: { clockTime: null, clockStatus: null, card: 'working' },
      ...workspace,
    },
    events: [],
    emails: [],
    ...extra,
  };
}

const proPastDue = dashboard({
  plan: 'pro',
  access: 'full',
  notice: { tone: 'warning', title: 'Payment failed', message: 'We’ll retry automatically.' },
  subscription: {
    status: 'past_due',
    plan: 'pro',
    interval: 'month',
    quantity: 12,
    currentPeriodEnd: '2027-01-06T12:00:00.000Z',
    cancelAtPeriodEnd: false,
  },
  hasActiveSubscription: true,
  canRetryPayment: true,
});

/** Routes fetch calls to canned responses and records them. */
function mockApi(routes: Record<string, unknown>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null });
      const key = `${method} ${url}`;
      const body = key in routes ? routes[key] : { error: `unexpected ${key}` };
      return new Response(JSON.stringify(body), { status: key in routes ? 200 : 500 });
    }),
  );
  return calls;
}

describe('App', () => {
  it('shows the Free plan, the read-only notice and upgrade buttons', async () => {
    mockApi({ 'GET /api/dashboard': dashboard() });
    render(<App />);
    expect(await screen.findByText('Over the Free plan limit.')).toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeEnabled();
    expect(screen.getByText('$84.00 per month')).toBeInTheDocument();
  });

  it('shows yearly prices with the 20% discount', async () => {
    mockApi({ 'GET /api/dashboard': dashboard() });
    render(<App />);
    await userEvent.click(await screen.findByLabelText('Yearly (save 20%)'));
    // Pro: $7 × 12 months × 0.8 = $67.20 per employee per year, × 12 employees.
    expect(screen.getByText('$806.40 per year')).toBeInTheDocument();
  });

  it('starts Checkout with the chosen plan and interval', async () => {
    const calls = mockApi({
      'GET /api/dashboard': dashboard(),
      'POST /api/billing/checkout': { url: 'https://checkout.stripe.test/x' },
    });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, search: '', pathname: '/' });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Upgrade to Starter' }));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ plan: 'starter', interval: 'month' });
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/x');
  });

  it('offers "Pay now" and the portal when a payment failed', async () => {
    const calls = mockApi({ 'GET /api/dashboard': proPastDue, 'POST /api/billing/retry-payment': { ok: true } });
    render(<App />);
    const overview = await screen.findByRole('region', { name: 'Current plan' });
    expect(within(overview).getByText('Past due')).toBeInTheDocument();
    expect(within(overview).getByText('$84.00 on January 6, 2027')).toBeInTheDocument();
    expect(within(overview).getByRole('button', { name: 'Manage in Stripe' })).toBeInTheDocument();
    // With a subscription, plan changes go through the portal instead of a second Checkout.
    expect(screen.queryByRole('button', { name: /Upgrade to/ })).not.toBeInTheDocument();
    await userEvent.click(within(overview).getByRole('button', { name: 'Pay now' }));
    expect(calls.some((c) => c.url === '/api/billing/retry-payment')).toBe(true);
  });

  it('shows the server’s message when an action fails', async () => {
    mockApi({ 'GET /api/dashboard': proPastDue });
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url) === '/api/billing/retry-payment'
        ? new Response(JSON.stringify({ error: 'The card was declined: Your card was declined.' }), { status: 402 })
        : new Response(JSON.stringify(proPastDue)),
    );
    render(<App />);
    const overview = await screen.findByRole('region', { name: 'Current plan' });
    await userEvent.click(within(overview).getByRole('button', { name: 'Pay now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The card was declined');
  });

  it('waits for the webhook after returning from Checkout', async () => {
    window.history.replaceState(null, '', '/?checkout=success');
    mockApi({ 'GET /api/dashboard': dashboard() });
    render(<App />);
    expect(await screen.findByText('Confirming your payment.')).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('lists webhook events, opens one, and filters by status', async () => {
    const calls = mockApi({
      'GET /api/dashboard': dashboard(
        {},
        {
          events: [
            {
              id: 'evt_1',
              type: 'invoice.paid',
              status: 'processed',
              attempts: 1,
              deliveries: 2,
              detail: 'Synced subscription; emailed "Receipt for $84.00"',
              receivedAt: '2026-11-06T12:00:00.000Z',
              processedAt: '2026-11-06T12:00:00.250Z',
            },
          ],
        },
      ),
      'POST /api/events/evt_1/replay': { ok: true },
    });
    render(<App />);
    const toggle = await screen.findByRole('button', { name: /invoice\.paid/ });
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(screen.getByText(/1 duplicate delivery skipped/)).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Stored as evt_1')).toBeInTheDocument();
    expect(screen.getByText(/Processed after 250 ms, 1 attempt/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Replay event' }));
    expect(calls.some((c) => c.url === '/api/events/evt_1/replay' && c.method === 'POST')).toBe(true);

    await userEvent.selectOptions(screen.getByLabelText('Filter events'), 'failed');
    expect(screen.getByText('No failed events.')).toBeInTheDocument();
  });

  it('switches the renewal card from the test-mode panel', async () => {
    const calls = mockApi({ 'GET /api/dashboard': proPastDue, 'PUT /api/demo/card': { ok: true } });
    render(<App />);
    const panel = await screen.findByRole('region', { name: 'Test mode' });
    await userEvent.selectOptions(within(panel).getByLabelText('Card used for renewals'), 'failing');
    expect(calls.find((c) => c.url === '/api/demo/card')?.body).toEqual({ card: 'failing' });
    expect(await screen.findByText(/charged to the card that declines/)).toBeInTheDocument();
  });
});
