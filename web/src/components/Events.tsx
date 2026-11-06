import { Fragment, useState } from 'react';
import type { WebhookEventStatus, WebhookEventView } from '../../../shared/billing.ts';
import { relativeTime, statusTone, time } from '../format.ts';
import { Button, Label, Section } from './ui.tsx';

interface Props {
  events: WebhookEventView[];
  busy: string | null;
  now: number;
  onReplay: (id: string) => void;
}

type Filter = 'all' | WebhookEventStatus;
const VISIBLE_ROWS = 10;

export function Events({ events, busy, now, onReplay }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const filtered = filter === 'all' ? events : events.filter((e) => e.status === filter);
  const visible = showAll ? filtered : filtered.slice(0, VISIBLE_ROWS);

  const duplicates = events.reduce((n, e) => n + Math.max(0, e.deliveries - 1), 0);
  const retried = events.filter((e) => e.attempts > 1).length;
  const failed = events.filter((e) => e.status === 'failed').length;

  return (
    <Section
      id="events"
      title="Webhook events"
      actions={
        <select aria-label="Filter events" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">All events</option>
          <option value="processed">Processed</option>
          <option value="ignored">Ignored</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
      }
      description={
        <>
          {events.length} received · {duplicates} duplicate {duplicates === 1 ? 'delivery' : 'deliveries'} skipped ·{' '}
          {retried} retried · {failed} failed. Each event is verified and stored before Stripe gets a response, then
          processed by a queue.
        </>
      }
    >
      {filtered.length === 0 ? (
        <p className="blank">
          {events.length === 0 ? 'No events yet. They appear here after your first checkout.' : `No ${filter} events.`}
        </p>
      ) : (
        <table className="table events">
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Status</th>
              <th scope="col" className="events__result">
                Result
              </th>
              <th scope="col" className="align-right">
                Received
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => {
              const expanded = open === e.id;
              const ms = e.processedAt ? Date.parse(e.processedAt) - Date.parse(e.receivedAt) : null;
              return (
                <Fragment key={e.id}>
                  <tr className={expanded ? 'is-open' : ''}>
                    <td className="events__name">
                      <button
                        type="button"
                        className="events__toggle"
                        aria-expanded={expanded}
                        aria-controls={`event-${e.id}`}
                        onClick={() => setOpen(expanded ? null : e.id)}
                      >
                        <span className="events__caret" aria-hidden="true">
                          ▸
                        </span>
                        <code>{e.type}</code>
                      </button>
                    </td>
                    <td className="nowrap">
                      <Label tone={statusTone(e.status)}>{e.status}</Label>
                      {e.deliveries > 1 && <span className="muted small"> ×{e.deliveries}</span>}
                    </td>
                    <td className="muted events__result">{e.detail ?? ''}</td>
                    <td className="muted nowrap align-right events__time" title={time(e.receivedAt)}>
                      {relativeTime(e.receivedAt, now)}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="events__details" id={`event-${e.id}`}>
                      <td colSpan={4}>
                        <ol className="timeline">
                          <li>
                            Received {time(e.receivedAt)}
                            {e.deliveries > 1 && ` (delivered ${e.deliveries} times, processed once)`}
                          </li>
                          <li>Stripe-Signature verified</li>
                          <li>Stored as {e.id}</li>
                          <li>
                            {e.status === 'pending'
                              ? `Waiting in the queue (attempt ${e.attempts + 1})`
                              : `${e.status[0]?.toUpperCase()}${e.status.slice(1)}${ms === null ? '' : ` after ${ms} ms`}, ${e.attempts} ${e.attempts === 1 ? 'attempt' : 'attempts'}: ${e.detail ?? 'no details'}`}
                          </li>
                        </ol>
                        {e.status !== 'pending' && (
                          <Button size="sm" busy={busy === `replay-${e.id}`} onClick={() => onReplay(e.id)}>
                            Replay event
                          </Button>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {filtered.length > VISIBLE_ROWS && (
        <Button variant="link" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${filtered.length}`}
        </Button>
      )}
    </Section>
  );
}
