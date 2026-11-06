export const money = (cents: number, { exact = false } = {}) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: exact || cents % 100 !== 0 ? 2 : 0,
  }).format(cents / 100);

export const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** "just now", "12s ago", "4m ago", then the clock time. */
export function relativeTime(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return time(iso);
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Past due',
  unpaid: 'Unpaid',
  canceled: 'Canceled',
  incomplete: 'Incomplete',
  incomplete_expired: 'Expired',
  paused: 'Paused',
};

export const statusLabel = (status: string) => STATUS_LABELS[status] ?? status;

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

export function statusTone(status: string): Tone {
  if (status === 'active' || status === 'trialing' || status === 'processed') return 'success';
  if (status === 'past_due' || status === 'incomplete' || status === 'pending') return 'warning';
  if (status === 'unpaid' || status === 'failed' || status === 'paused') return 'danger';
  return 'neutral';
}
