import {
  type AccessLevel,
  FREE_EMPLOYEE_LIMIT,
  type Notice,
  type PlanId,
  parseLookupKey,
} from '../../../shared/billing.ts';

export interface AccessInput {
  employees: number;
  subscription: {
    status: string;
    lookupKey: string | null;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
  } | null;
}

export interface Access {
  plan: PlanId;
  level: AccessLevel;
  notice: Notice | null;
}

const date = (unixSeconds: number | null) =>
  unixSeconds === null
    ? 'the end of the period'
    : new Date(unixSeconds * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

/**
 * Turns a Stripe subscription status into what the customer can do in the product.
 * This is the one place that decides access, and it follows TidyShift's billing policy:
 * failed payments get a grace period while Stripe retries, and the workspace becomes
 * read-only only after every retry has failed. No data is ever deleted.
 */
export function accessFor({ employees, subscription }: AccessInput): Access {
  const paid = parseLookupKey(subscription?.lookupKey ?? null);

  switch (subscription?.status) {
    case 'active':
    case 'trialing':
      return {
        plan: paid?.plan ?? 'free',
        level: 'full',
        notice: subscription.cancelAtPeriodEnd
          ? {
              tone: 'info',
              title: 'Subscription ends soon',
              message: `Your plan stays active until ${date(subscription.currentPeriodEnd)}, then the workspace moves to Free.`,
            }
          : null,
      };
    case 'past_due':
      return {
        plan: paid?.plan ?? 'free',
        level: 'full',
        notice: {
          tone: 'warning',
          title: 'Payment failed',
          message:
            'We couldn’t charge your card. We’ll retry automatically, and you keep full access meanwhile. Update your card or pay now to avoid read-only mode.',
        },
      };
    case 'unpaid':
    case 'paused':
      return {
        plan: paid?.plan ?? 'free',
        level: 'read_only',
        notice: {
          tone: 'danger',
          title: 'Workspace is read-only',
          message:
            'All payment retries failed. Managers can view schedules but can’t publish new ones. Update your card to restore access immediately.',
        },
      };
    case 'incomplete':
      return freePlan(employees, {
        tone: 'warning',
        title: 'Payment not completed',
        message: 'The first payment needs attention. Finish it in Stripe Checkout, or start again.',
      });
    default:
      // No subscription, canceled, or incomplete_expired: the workspace is on Free.
      return freePlan(employees, null);
  }
}

function freePlan(employees: number, notice: Notice | null): Access {
  if (employees <= FREE_EMPLOYEE_LIMIT) return { plan: 'free', level: 'full', notice };
  return {
    plan: 'free',
    level: 'read_only',
    notice: notice ?? {
      tone: 'danger',
      title: 'Over the Free plan limit',
      message: `Free covers up to ${FREE_EMPLOYEE_LIMIT} employees and you have ${employees}. The workspace is read-only until you upgrade or remove employees.`,
    },
  };
}

/** Statuses where a subscription still exists and Checkout must not create a second one. */
export function isLiveSubscription(status: string | undefined): boolean {
  return (
    status === 'active' ||
    status === 'trialing' ||
    status === 'past_due' ||
    status === 'unpaid' ||
    status === 'paused' ||
    status === 'incomplete'
  );
}
