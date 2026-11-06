export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

export const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

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

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function statusTone(status: string): Tone {
  if (status === 'active' || status === 'trialing' || status === 'processed') return 'success';
  if (status === 'past_due' || status === 'incomplete' || status === 'pending') return 'warning';
  if (status === 'unpaid' || status === 'failed' || status === 'paused') return 'danger';
  return 'neutral';
}
