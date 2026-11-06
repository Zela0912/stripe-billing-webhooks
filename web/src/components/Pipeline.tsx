import { Database, Layers, type LucideIcon, RefreshCw, ShieldCheck, Webhook, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { WebhookEventView } from '../../../shared/billing.ts';
import { relativeTime, statusTone } from '../format.ts';
import { Badge } from './ui.tsx';

const STAGES: { icon: LucideIcon; title: string; detail: string }[] = [
  { icon: Webhook, title: 'Stripe', detail: 'sends the event' },
  { icon: ShieldCheck, title: 'Verify', detail: 'HMAC signature' },
  { icon: Database, title: 'Store', detail: 'event id is unique' },
  { icon: Layers, title: 'Queue', detail: 'retries with backoff' },
  { icon: RefreshCw, title: 'Re-sync', detail: 'fresh state from API' },
  { icon: Zap, title: 'TidyShift', detail: 'access updated' },
];

/** The webhook pipeline as a diagram, lit up whenever a new event comes through. */
export function Pipeline({ events, now }: { events: WebhookEventView[]; now: number }) {
  const latest = events[0];
  const [flowKey, setFlowKey] = useState(0);
  const lastSeen = useRef<string | null>(null);

  useEffect(() => {
    if (!latest) return;
    if (lastSeen.current !== null && lastSeen.current !== latest.id) setFlowKey((k) => k + 1);
    lastSeen.current = latest.id;
  }, [latest]);

  const duplicates = events.reduce((n, e) => n + Math.max(0, e.deliveries - 1), 0);
  const retries = events.reduce((n, e) => n + Math.max(0, e.attempts - 1), 0);
  const failed = events.filter((e) => e.status === 'failed').length;

  const stats: [string, number, string][] = [
    ['Events', events.length, 'received for this workspace'],
    ['Duplicates', duplicates, 'delivered again, run once'],
    ['Retries', retries, 'after a failed attempt'],
    ['Failed', failed, 'waiting for a replay'],
  ];

  return (
    <section className="pipeline" aria-labelledby="pipeline-title">
      <div className="pipeline__head">
        <div>
          <p className="eyebrow" id="pipeline-title">
            Webhook pipeline
          </p>
          <p className="pipeline__lead">
            Stripe gets its <code className="inline-code">200 OK</code> in milliseconds; the work happens afterwards, in
            a queue.
          </p>
        </div>
        {latest && (
          <p className="pipeline__latest" aria-live="polite">
            <span className="mono">{latest.type}</span>
            <Badge tone={statusTone(latest.status)} dot>
              {latest.status}
            </Badge>
            <span className="muted">{relativeTime(latest.receivedAt, now)}</span>
          </p>
        )}
      </div>

      <ol className={`stages ${flowKey > 0 ? 'is-flowing' : ''}`} key={flowKey}>
        {STAGES.map(({ icon: Icon, title, detail }, i) => (
          <li key={title} className="stage" style={{ '--i': i } as React.CSSProperties}>
            <span className="stage__icon">
              <Icon size={16} aria-hidden="true" />
            </span>
            <span className="stage__title">{title}</span>
            <span className="stage__detail">{detail}</span>
          </li>
        ))}
      </ol>

      <dl className="stats">
        {stats.map(([label, value, hint]) => (
          <div key={label} className={label === 'Failed' && value > 0 ? 'is-alert' : ''}>
            <dt>{label}</dt>
            <dd>{value}</dd>
            <dd className="stats__hint">{hint}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
