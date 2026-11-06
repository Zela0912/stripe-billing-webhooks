import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { WebhookEventStatus } from '../../shared/billing.ts';

export interface Workspace {
  id: string;
  name: string;
  billingEmail: string;
  employees: number;
  stripeCustomerId: string | null;
  testClockId: string | null;
  /** Unix seconds of the test clock, kept in sync by test_helpers.test_clock.* webhooks. */
  clockTime: number | null;
  clockStatus: 'ready' | 'advancing' | null;
  demoCard: 'working' | 'failing';
  createdAt: string;
}

/** Our copy of a Stripe subscription. Always written from a fresh API read, never from an event payload. */
export interface StoredSubscription {
  id: string;
  workspaceId: string;
  customerId: string;
  status: string;
  lookupKey: string | null;
  itemId: string | null;
  quantity: number;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  latestInvoiceId: string | null;
  syncedAt: string;
}

export interface StoredEvent {
  id: string;
  type: string;
  workspaceId: string | null;
  payload: string;
  status: WebhookEventStatus;
  attempts: number;
  deliveries: number;
  detail: string | null;
  /** Epoch ms when the queue may (re)try this event. */
  nextAttemptAt: number;
  receivedAt: string;
  processedAt: string | null;
}

export interface StoredEmail {
  id: number;
  workspaceId: string;
  to: string;
  subject: string;
  body: string;
  eventId: string;
  sentAt: string;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * All persistence lives here. The methods are storage-agnostic, so a Postgres version of
 * this class could replace SQLite without touching the rest of the app.
 */
export class Store {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS workspaces (
        id                 TEXT PRIMARY KEY,
        name               TEXT NOT NULL,
        billing_email      TEXT NOT NULL,
        employees          INTEGER NOT NULL,
        stripe_customer_id TEXT UNIQUE,
        test_clock_id      TEXT UNIQUE,
        clock_time         INTEGER,
        clock_status       TEXT,
        demo_card          TEXT NOT NULL DEFAULT 'working',
        created_at         TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS subscriptions (
        id                   TEXT PRIMARY KEY,
        workspace_id         TEXT NOT NULL REFERENCES workspaces(id),
        customer_id          TEXT NOT NULL,
        status               TEXT NOT NULL,
        lookup_key           TEXT,
        item_id              TEXT,
        quantity             INTEGER NOT NULL,
        current_period_end   INTEGER,
        cancel_at_period_end INTEGER NOT NULL,
        latest_invoice_id    TEXT,
        synced_at            TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS subscriptions_workspace ON subscriptions(workspace_id);
      -- One row per Stripe event id: the primary key is what makes processing idempotent.
      CREATE TABLE IF NOT EXISTS webhook_events (
        id              TEXT PRIMARY KEY,
        type            TEXT NOT NULL,
        workspace_id    TEXT,
        payload         TEXT NOT NULL,
        status          TEXT NOT NULL,
        attempts        INTEGER NOT NULL DEFAULT 0,
        deliveries      INTEGER NOT NULL DEFAULT 1,
        detail          TEXT,
        next_attempt_at INTEGER NOT NULL,
        received_at     TEXT NOT NULL,
        processed_at    TEXT
      );
      CREATE INDEX IF NOT EXISTS webhook_events_due ON webhook_events(status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS webhook_events_workspace ON webhook_events(workspace_id, received_at);
      -- Outgoing emails (simulated). dedupe_key makes each side effect happen once, even when
      -- Stripe sends two different events about the same thing.
      CREATE TABLE IF NOT EXISTS emails (
        id           INTEGER PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        dedupe_key   TEXT NOT NULL UNIQUE,
        to_address   TEXT NOT NULL,
        subject      TEXT NOT NULL,
        body         TEXT NOT NULL,
        event_id     TEXT NOT NULL,
        sent_at      TEXT NOT NULL
      );
    `);
  }

  // ---- workspaces ---------------------------------------------------------------------

  createWorkspace(w: { id: string; name: string; billingEmail: string; employees: number }, now: Date): Workspace {
    this.db
      .prepare('INSERT INTO workspaces (id, name, billing_email, employees, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(w.id, w.name, w.billingEmail, w.employees, now.toISOString());
    const created = this.workspace(w.id);
    if (!created) throw new Error(`Workspace ${w.id} was not created`);
    return created;
  }

  workspace(id: string): Workspace | null {
    return this.workspaceWhere('id = ?', id);
  }

  workspaceByCustomer(customerId: string): Workspace | null {
    return this.workspaceWhere('stripe_customer_id = ?', customerId);
  }

  workspaceByTestClock(clockId: string): Workspace | null {
    return this.workspaceWhere('test_clock_id = ?', clockId);
  }

  setStripeCustomer(id: string, customerId: string, clock: { id: string; time: number } | null): void {
    this.db
      .prepare(
        `UPDATE workspaces SET stripe_customer_id = ?, test_clock_id = ?, clock_time = ?, clock_status = ? WHERE id = ?`,
      )
      .run(customerId, clock?.id ?? null, clock?.time ?? null, clock ? 'ready' : null, id);
  }

  setClock(id: string, clock: { time?: number; status: 'ready' | 'advancing' }): void {
    this.db
      .prepare('UPDATE workspaces SET clock_time = COALESCE(?, clock_time), clock_status = ? WHERE id = ?')
      .run(clock.time ?? null, clock.status, id);
  }

  setEmployees(id: string, employees: number): void {
    this.db.prepare('UPDATE workspaces SET employees = ? WHERE id = ?').run(employees, id);
  }

  setDemoCard(id: string, card: 'working' | 'failing'): void {
    this.db.prepare('UPDATE workspaces SET demo_card = ? WHERE id = ?').run(card, id);
  }

  private workspaceWhere(where: string, value: string): Workspace | null {
    const r = this.db.prepare(`SELECT * FROM workspaces WHERE ${where}`).get(value) as Row | undefined;
    if (!r) return null;
    return {
      id: str(r.id),
      name: str(r.name),
      billingEmail: str(r.billing_email),
      employees: Number(r.employees),
      stripeCustomerId: strOrNull(r.stripe_customer_id),
      testClockId: strOrNull(r.test_clock_id),
      clockTime: numOrNull(r.clock_time),
      clockStatus: r.clock_status === 'ready' || r.clock_status === 'advancing' ? r.clock_status : null,
      demoCard: r.demo_card === 'failing' ? 'failing' : 'working',
      createdAt: str(r.created_at),
    };
  }

  // ---- subscriptions ------------------------------------------------------------------

  upsertSubscription(s: Omit<StoredSubscription, 'syncedAt'>, now: Date): void {
    this.db
      .prepare(
        `INSERT INTO subscriptions (id, workspace_id, customer_id, status, lookup_key, item_id, quantity,
           current_period_end, cancel_at_period_end, latest_invoice_id, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status, lookup_key = excluded.lookup_key, item_id = excluded.item_id,
           quantity = excluded.quantity, current_period_end = excluded.current_period_end,
           cancel_at_period_end = excluded.cancel_at_period_end, latest_invoice_id = excluded.latest_invoice_id,
           synced_at = excluded.synced_at`,
      )
      .run(
        s.id,
        s.workspaceId,
        s.customerId,
        s.status,
        s.lookupKey,
        s.itemId,
        s.quantity,
        s.currentPeriodEnd,
        s.cancelAtPeriodEnd ? 1 : 0,
        s.latestInvoiceId,
        now.toISOString(),
      );
  }

  /** The subscription that decides access: a live one if there is one, else the most recent ended one. */
  currentSubscription(workspaceId: string): StoredSubscription | null {
    const r = this.db
      .prepare(
        `SELECT * FROM subscriptions WHERE workspace_id = ?
         ORDER BY CASE WHEN status IN ('canceled', 'incomplete_expired') THEN 1 ELSE 0 END,
                  COALESCE(current_period_end, 0) DESC
         LIMIT 1`,
      )
      .get(workspaceId) as Row | undefined;
    if (!r) return null;
    return {
      id: str(r.id),
      workspaceId: str(r.workspace_id),
      customerId: str(r.customer_id),
      status: str(r.status),
      lookupKey: strOrNull(r.lookup_key),
      itemId: strOrNull(r.item_id),
      quantity: Number(r.quantity),
      currentPeriodEnd: numOrNull(r.current_period_end),
      cancelAtPeriodEnd: Number(r.cancel_at_period_end) === 1,
      latestInvoiceId: strOrNull(r.latest_invoice_id),
      syncedAt: str(r.synced_at),
    };
  }

  // ---- webhook events -----------------------------------------------------------------

  /**
   * Records a delivered event. Returns false when the event id was already recorded: Stripe
   * sometimes delivers the same event more than once, and it must only be processed once.
   */
  recordEvent(e: { id: string; type: string; workspaceId: string | null; payload: string }, now: Date): boolean {
    const { changes } = this.db
      .prepare(
        `INSERT INTO webhook_events (id, type, workspace_id, payload, status, next_attempt_at, received_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT(id) DO NOTHING`,
      )
      .run(e.id, e.type, e.workspaceId, e.payload, now.getTime(), now.toISOString());
    if (Number(changes) > 0) return true;
    this.db.prepare('UPDATE webhook_events SET deliveries = deliveries + 1 WHERE id = ?').run(e.id);
    return false;
  }

  event(id: string): StoredEvent | null {
    const r = this.db.prepare('SELECT * FROM webhook_events WHERE id = ?').get(id) as Row | undefined;
    return r ? toEvent(r) : null;
  }

  /** The oldest event that is waiting and due. The queue processes events one at a time, in arrival order. */
  nextDueEvent(nowMs: number): StoredEvent | null {
    const r = this.db
      .prepare(
        `SELECT * FROM webhook_events WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY received_at, rowid LIMIT 1`,
      )
      .get(nowMs) as Row | undefined;
    return r ? toEvent(r) : null;
  }

  /** When the next waiting event becomes due (epoch ms), so the queue can sleep until then. */
  nextAttemptAt(): number | null {
    const r = this.db.prepare(`SELECT MIN(next_attempt_at) AS at FROM webhook_events WHERE status = 'pending'`).get() as
      | Row
      | undefined;
    return numOrNull(r?.at);
  }

  beginAttempt(id: string): number {
    this.db.prepare('UPDATE webhook_events SET attempts = attempts + 1 WHERE id = ?').run(id);
    return this.event(id)?.attempts ?? 0;
  }

  finishEvent(id: string, status: 'processed' | 'ignored', detail: string | null, now: Date): void {
    this.db
      .prepare('UPDATE webhook_events SET status = ?, detail = ?, processed_at = ? WHERE id = ?')
      .run(status, detail, now.toISOString(), id);
  }

  scheduleRetry(id: string, error: string, nextAttemptAt: number): void {
    this.db
      .prepare(`UPDATE webhook_events SET status = 'pending', detail = ?, next_attempt_at = ? WHERE id = ?`)
      .run(error, nextAttemptAt, id);
  }

  failEvent(id: string, error: string, now: Date): void {
    this.db
      .prepare(`UPDATE webhook_events SET status = 'failed', detail = ?, processed_at = ? WHERE id = ?`)
      .run(error, now.toISOString(), id);
  }

  /** Puts an event back in the queue with a fresh retry budget (the "Replay" button). */
  requeueEvent(id: string, now: Date): void {
    this.db
      .prepare(
        `UPDATE webhook_events SET status = 'pending', attempts = 0, detail = NULL, processed_at = NULL,
           next_attempt_at = ? WHERE id = ?`,
      )
      .run(now.getTime(), id);
  }

  eventsForWorkspace(workspaceId: string, limit = 50): StoredEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM webhook_events WHERE workspace_id = ? ORDER BY received_at DESC, rowid DESC LIMIT ?')
      .all(workspaceId, limit) as Row[];
    return rows.map(toEvent);
  }

  // ---- emails -------------------------------------------------------------------------

  /** Returns false when an email with this dedupe key was already sent. */
  sendEmail(e: Omit<StoredEmail, 'id' | 'sentAt'> & { dedupeKey: string }, now: Date): boolean {
    const { changes } = this.db
      .prepare(
        `INSERT INTO emails (workspace_id, dedupe_key, to_address, subject, body, event_id, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING`,
      )
      .run(e.workspaceId, e.dedupeKey, e.to, e.subject, e.body, e.eventId, now.toISOString());
    return Number(changes) > 0;
  }

  emailsForWorkspace(workspaceId: string, limit = 20): StoredEmail[] {
    const rows = this.db
      .prepare('SELECT * FROM emails WHERE workspace_id = ? ORDER BY id DESC LIMIT ?')
      .all(workspaceId, limit) as Row[];
    return rows.map((r) => ({
      id: Number(r.id),
      workspaceId: str(r.workspace_id),
      to: str(r.to_address),
      subject: str(r.subject),
      body: str(r.body),
      eventId: str(r.event_id),
      sentAt: str(r.sent_at),
    }));
  }

  close(): void {
    this.db.close();
  }
}

function toEvent(r: Row): StoredEvent {
  const status = str(r.status);
  return {
    id: str(r.id),
    type: str(r.type),
    workspaceId: strOrNull(r.workspace_id),
    payload: str(r.payload),
    status: status === 'processed' || status === 'ignored' || status === 'failed' ? status : 'pending',
    attempts: Number(r.attempts),
    deliveries: Number(r.deliveries),
    detail: strOrNull(r.detail),
    nextAttemptAt: Number(r.next_attempt_at),
    receivedAt: str(r.received_at),
    processedAt: strOrNull(r.processed_at),
  };
}
