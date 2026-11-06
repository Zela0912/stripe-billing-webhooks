/**
 * The contract between server and web: the plan catalog and the API payloads.
 * Both sides import this file, so a change here is checked by the compiler on both.
 */

export const PAID_PLANS = ['starter', 'pro'] as const;
export type PaidPlanId = (typeof PAID_PLANS)[number];
export type PlanId = 'free' | PaidPlanId;

export const INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof INTERVALS)[number];

export interface PlanDefinition {
  name: string;
  tagline: string;
  features: string[];
}

/** The Free plan covers up to this many employees. Above it, a workspace on Free is read-only. */
export const FREE_EMPLOYEE_LIMIT = 10;

/** Annual billing is 20% cheaper than paying monthly. */
export const ANNUAL_DISCOUNT = 0.2;

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    name: 'Free',
    tagline: `Up to ${FREE_EMPLOYEE_LIMIT} employees, 1 location`,
    features: ['Scheduling', 'Mobile app', 'Shift reminders'],
  },
  starter: {
    name: 'Starter',
    tagline: 'Single-location businesses',
    features: ['Everything in Free', 'Shift swaps', 'Time-off requests', 'Unlimited employees'],
  },
  pro: {
    name: 'Pro',
    tagline: 'Multiple locations and payroll',
    features: ['Everything in Starter', 'Unlimited locations', 'Time clock with GPS', 'Payroll export'],
  },
};

/** Price per active employee per month, in cents. */
export const MONTHLY_SEAT_CENTS: Record<PaidPlanId, number> = { starter: 400, pro: 700 };

/** What one employee costs for a whole billing period, in cents. */
export function seatPriceCents(plan: PaidPlanId, interval: BillingInterval): number {
  const monthly = MONTHLY_SEAT_CENTS[plan];
  return interval === 'month' ? monthly : Math.round(monthly * 12 * (1 - ANNUAL_DISCOUNT));
}

/**
 * Stripe Price lookup key. The code refers to prices by these stable names instead of
 * price ids, so the same code runs against any sandbox or the live account.
 */
export function lookupKey(plan: PaidPlanId, interval: BillingInterval): string {
  return `tidyshift_${plan}_${interval === 'month' ? 'monthly' : 'yearly'}`;
}

export function parseLookupKey(key: string | null): { plan: PaidPlanId; interval: BillingInterval } | null {
  for (const plan of PAID_PLANS) {
    for (const interval of INTERVALS) {
      if (lookupKey(plan, interval) === key) return { plan, interval };
    }
  }
  return null;
}

// ---- API payloads ---------------------------------------------------------------------

export type AccessLevel = 'full' | 'read_only';
export type NoticeTone = 'info' | 'warning' | 'danger';

export interface Notice {
  tone: NoticeTone;
  title: string;
  message: string;
}

export interface SubscriptionView {
  status: string;
  plan: PaidPlanId | null;
  interval: BillingInterval | null;
  quantity: number;
  /** ISO date. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface WorkspaceView {
  id: string;
  name: string;
  billingEmail: string;
  employees: number;
  /** The plan the workspace gets features from right now. */
  plan: PlanId;
  access: AccessLevel;
  notice: Notice | null;
  subscription: SubscriptionView | null;
  /** True while a subscription exists that Checkout must not duplicate. */
  hasActiveSubscription: boolean;
  canRetryPayment: boolean;
  /** Present only in demo mode. */
  demo: DemoView | null;
}

export interface DemoView {
  /** ISO date of the Stripe test clock, the "now" of this workspace's billing. */
  clockTime: string | null;
  clockStatus: 'ready' | 'advancing' | null;
  card: 'working' | 'failing';
}

export type WebhookEventStatus = 'pending' | 'processed' | 'ignored' | 'failed';

export interface WebhookEventView {
  id: string;
  type: string;
  status: WebhookEventStatus;
  attempts: number;
  /** How many times Stripe delivered this event. More than 1 means duplicates were caught. */
  deliveries: number;
  detail: string | null;
  receivedAt: string;
  processedAt: string | null;
}

export interface EmailView {
  id: number;
  to: string;
  subject: string;
  body: string;
  sentAt: string;
}

export interface Dashboard {
  workspace: WorkspaceView;
  events: WebhookEventView[];
  emails: EmailView[];
}

export interface RedirectResponse {
  url: string;
}

export interface ApiErrorBody {
  error: string;
}
