import { MailCheck, MailWarning } from 'lucide-react';
import type { EmailView } from '../../../shared/billing.ts';
import { relativeTime } from '../format.ts';
import { Section } from './ui.tsx';

export function Inbox({ emails, now }: { emails: EmailView[]; now: number }) {
  return (
    <Section
      id="emails"
      title="Emails sent"
      description="Simulated outbox. Each email goes out once, even when Stripe repeats an event."
    >
      {emails.length === 0 ? (
        <p className="empty empty--compact">Receipts and payment warnings will show up here.</p>
      ) : (
        <ul className="inbox">
          {emails.map((m) => {
            const warning = m.subject.startsWith('Payment failed');
            return (
              <li key={m.id} className="mail">
                <span className={`mail__icon ${warning ? 'is-warning' : ''}`} aria-hidden="true">
                  {warning ? <MailWarning size={16} /> : <MailCheck size={16} />}
                </span>
                <div className="mail__body">
                  <div className="mail__head">
                    <strong>{m.subject}</strong>
                    <span className="mail__time">{relativeTime(m.sentAt, now)}</span>
                  </div>
                  <p className="mail__to">to {m.to}</p>
                  <p className="mail__text">{m.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
