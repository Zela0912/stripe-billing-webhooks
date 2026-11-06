import { ChevronRight, CircleCheck, CircleDashed, CircleMinus, CircleX, Inbox, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { WebhookEventStatus, WebhookEventView } from '../../../shared/billing.ts';
import { relativeTime, time } from '../format.ts';
import { Badge, Button, Section } from './ui.tsx';

interface Props {
  events: WebhookEventView[];
  busy: string | null;
  now: number;
  onReplay: (id: string) => void;
}

type Filter = 'all' | WebhookEventStatus;
const FILTERS: Filter[] = ['all', 'processed', 'ignored', 'failed'];
const VISIBLE_ROWS = 8;

const STATUS_ICON = {
  processed: <CircleCheck size={16} className="tone-success" aria-hidden="true" />,
  ignored: <CircleMinus size={16} className="tone-neutral" aria-hidden="true" />,
  failed: <CircleX size={16} className="tone-danger" aria-hidden="true" />,
  pending: <CircleDashed size={16} className="tone-warning spin-slow" aria-hidden="true" />,
} satisfies Record<WebhookEventStatus, React.ReactNode>;

export function Events({ events, busy, now, onReplay }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const count = (f: Filter) => (f === 'all' ? events.length : events.filter((e) => e.status === f).length);
  const filtered = filter === 'all' ? events : events.filter((e) => e.status === filter);
  const visible = showAll ? filtered : filtered.slice(0, VISIBLE_ROWS);

  return (
    <Section
      id="events"
      title="Webhook events"
      description="Every event Stripe sent for this workspace, newest first. Open one to see what happened."
      actions={
        <fieldset className="tabs">
          <legend className="sr-only">Filter events</legend>
          {FILTERS.map((f) => (
            <label key={f} className={filter === f ? 'is-selected' : ''}>
              <input type="radio" name="event-filter" value={f} checked={filter === f} onChange={() => setFilter(f)} />
              {f === 'all' ? 'All' : f[0]?.toUpperCase() + f.slice(1)}
              <span className="tabs__count">{count(f)}</span>
            </label>
          ))}
        </fieldset>
      }
    >
      {visible.length === 0 ? (
        <div className="empty">
          <Inbox size={20} aria-hidden="true" />
          <p>
            {events.length === 0
              ? 'No events yet. Subscribe to a plan and they will stream in here.'
              : `No ${filter} events.`}
          </p>
        </div>
      ) : (
        <ul className="events">
          {visible.map((e) => {
            const expanded = open === e.id;
            const ms = e.processedAt ? Date.parse(e.processedAt) - Date.parse(e.receivedAt) : null;
            return (
              <li key={e.id} className={`event ${expanded ? 'is-open' : ''}`}>
                <button
                  type="button"
                  className="event__row"
                  aria-expanded={expanded}
                  aria-controls={`event-${e.id}`}
                  onClick={() => setOpen(expanded ? null : e.id)}
                >
                  {STATUS_ICON[e.status]}
                  <span className="event__type mono">{e.type}</span>
                  <span className="event__detail">
                    {e.detail ?? (e.status === 'pending' ? 'Waiting in queue…' : '')}
                  </span>
                  <span className="event__meta">
                    {e.deliveries > 1 && <Badge tone="info">{e.deliveries}× delivered</Badge>}
                    {e.attempts > 1 && <Badge tone="warning">{e.attempts} attempts</Badge>}
                    <span className="event__time">{relativeTime(e.receivedAt, now)}</span>
                  </span>
                  <ChevronRight size={16} className="event__chevron" aria-hidden="true" />
                </button>
                {expanded && (
                  <div className="event__body" id={`event-${e.id}`}>
                    <dl className="kv">
                      <div>
                        <dt>Event ID</dt>
                        <dd className="mono">{e.id}</dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>{e.status}</dd>
                      </div>
                      <div>
                        <dt>Received</dt>
                        <dd>{time(e.receivedAt)}</dd>
                      </div>
                      <div>
                        <dt>Processed</dt>
                        <dd>{ms === null ? '—' : `${ms} ms after receipt`}</dd>
                      </div>
                      <div>
                        <dt>Deliveries</dt>
                        <dd>
                          {e.deliveries}
                          {e.deliveries > 1 && ' (duplicates acknowledged and skipped)'}
                        </dd>
                      </div>
                      <div>
                        <dt>Attempts</dt>
                        <dd>{e.attempts}</dd>
                      </div>
                      <div className="kv__wide">
                        <dt>Result</dt>
                        <dd>{e.detail ?? '—'}</dd>
                      </div>
                    </dl>
                    {e.status !== 'pending' && (
                      <div className="event__actions">
                        <Button
                          size="sm"
                          icon={<RotateCcw size={14} aria-hidden="true" />}
                          busy={busy === `replay-${e.id}`}
                          onClick={() => onReplay(e.id)}
                        >
                          Replay
                        </Button>
                        <span className="muted small">Runs the same idempotent handler again.</span>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > VISIBLE_ROWS && (
        <div className="events__more">
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `Show all ${filtered.length} events`}
          </Button>
        </div>
      )}
    </Section>
  );
}
