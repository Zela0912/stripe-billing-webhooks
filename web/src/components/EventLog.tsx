import type { EmailView, WebhookEventView } from '../../../shared/billing.ts';
import { statusTone, time } from '../format.ts';
import { Button, Card, Pill } from './ui.tsx';

interface Props {
  events: WebhookEventView[];
  busy: string | null;
  onReplay: (id: string) => void;
}

export function EventLog({ events, busy, onReplay }: Props) {
  return (
    <Card
      title="Webhook events"
      className="area-events"
      description="Every event Stripe sent for this workspace: verified, stored, then processed by a queue with retries."
    >
      {events.length === 0 ? (
        <p className="empty">No events yet. Subscribe to a plan and they will appear here live.</p>
      ) : (
        <div className="table-wrap">
          <table className="events">
            <thead>
              <tr>
                <th scope="col">Received</th>
                <th scope="col">Event</th>
                <th scope="col">Status</th>
                <th scope="col">Result</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td data-label="Received" className="nowrap muted">
                    {time(e.receivedAt)}
                  </td>
                  <td data-label="Event">
                    <code className="event-type">{e.type}</code>
                    <span className="event-id">{e.id}</span>
                  </td>
                  <td data-label="Status" className="nowrap">
                    <Pill tone={statusTone(e.status)}>{e.status}</Pill>
                    {e.attempts > 1 && <span className="meta">{e.attempts} attempts</span>}
                    {e.deliveries > 1 && (
                      <span className="meta" title="Stripe delivered this event more than once; it ran once">
                        {e.deliveries}× delivered
                      </span>
                    )}
                  </td>
                  <td data-label="Result" className="event-detail">
                    {e.detail ?? '—'}
                  </td>
                  <td className="nowrap">
                    {e.status !== 'pending' && (
                      <Button variant="ghost" busy={busy === `replay-${e.id}`} onClick={() => onReplay(e.id)}>
                        Replay
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function Outbox({ emails }: { emails: EmailView[] }) {
  return (
    <Card
      title="Emails sent"
      className="area-emails"
      description="Simulated. Each one is sent once, even if Stripe repeats an event."
    >
      {emails.length === 0 ? (
        <p className="empty">Receipts and payment warnings will show up here.</p>
      ) : (
        <ul className="emails">
          {emails.map((m) => (
            <li key={m.id}>
              <div className="emails__head">
                <strong>{m.subject}</strong>
                <span className="muted small">{time(m.sentAt)}</span>
              </div>
              <p className="small muted">To {m.to}</p>
              <p className="small">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
