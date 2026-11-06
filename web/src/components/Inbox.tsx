import type { EmailView } from '../../../shared/billing.ts';
import { relativeTime, time } from '../format.ts';
import { Section } from './ui.tsx';

export function Inbox({ emails, now }: { emails: EmailView[]; now: number }) {
  return (
    <Section
      id="emails"
      title="Billing emails"
      description="Simulated. Each email is keyed on the invoice, so a repeated event never sends it twice."
    >
      {emails.length === 0 ? (
        <p className="blank">Receipts and payment warnings will appear here.</p>
      ) : (
        <ul className="emails">
          {emails.map((m) => (
            <li key={m.id}>
              <div className="emails__head">
                <strong>{m.subject}</strong>
                <span className="muted small" title={time(m.sentAt)}>
                  {relativeTime(m.sentAt, now)}
                </span>
              </div>
              <p className="muted small">To {m.to}</p>
              <p>{m.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
