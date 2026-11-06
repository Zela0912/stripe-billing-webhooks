import type { ApiErrorBody, BillingInterval, Dashboard, PaidPlanId, RedirectResponse } from '../../shared/billing.ts';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: init.body ? { 'content-type': 'application/json' } : undefined,
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the server. Check your connection and try again.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

const send = (method: 'POST' | 'PUT', body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const api = {
  dashboard: () => request<Dashboard>('/api/dashboard'),
  checkout: (plan: PaidPlanId, interval: BillingInterval) =>
    request<RedirectResponse>('/api/billing/checkout', send('POST', { plan, interval })),
  portal: () => request<RedirectResponse>('/api/billing/portal', send('POST')),
  retryPayment: () => request<{ ok: true }>('/api/billing/retry-payment', send('POST')),
  setEmployees: (employees: number) => request<{ ok: true }>('/api/workspace/employees', send('PUT', { employees })),
  replay: (eventId: string) => request<{ ok: true }>(`/api/events/${encodeURIComponent(eventId)}/replay`, send('POST')),
  advanceToRenewal: () => request<{ ok: true }>('/api/demo/advance-to-renewal', send('POST')),
  setCard: (card: 'working' | 'failing') => request<{ ok: true }>('/api/demo/card', send('PUT', { card })),
};
