import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { type ApiErrorBody, INTERVALS, PAID_PLANS, type RedirectResponse } from '../../../shared/billing.ts';
import { PaymentDeclinedError } from '../billing/gateway.ts';
import {
  AppError,
  advanceToRenewal,
  type BillingDeps,
  createDemoWorkspace,
  dashboard,
  openPortal,
  retryPayment,
  setEmployees,
  startCheckout,
  useTestCard,
} from '../billing/service.ts';
import { issueWorkspaceId, readWorkspaceId } from '../session.ts';
import type { Store, Workspace } from '../store.ts';
import type { WebhookQueue } from '../webhooks/queue.ts';

export interface BillingRouteDeps extends BillingDeps {
  queue: WebhookQueue;
  secureCookies: boolean;
}

const CheckoutBody = z.object({ plan: z.enum(PAID_PLANS), interval: z.enum(INTERVALS) });
const EmployeesBody = z.object({ employees: z.number().int().min(1).max(500) });
const CardBody = z.object({ card: z.enum(['working', 'failing']) });

export function billingRouter(deps: BillingRouteDeps): express.Router {
  const router = express.Router();
  const store: Store = deps.store;

  /** Every action below works on the caller's own workspace and nothing else. */
  const requireWorkspace = (req: Request, res: Response): Workspace | null => {
    const id = readWorkspaceId(req);
    const ws = id ? store.workspace(id) : null;
    if (!ws) res.status(401).json({ error: 'Your session expired. Reload the page.' } satisfies ApiErrorBody);
    return ws;
  };

  router.get('/api/dashboard', (req, res) => {
    const id = readWorkspaceId(req);
    const ws =
      (id ? store.workspace(id) : null) ?? createDemoWorkspace(deps, issueWorkspaceId(res, deps.secureCookies));
    res.set('Cache-Control', 'no-store').json(dashboard(ws, deps));
  });

  router.post('/api/billing/checkout', async (req, res) => {
    const ws = requireWorkspace(req, res);
    if (!ws) return;
    const body = CheckoutBody.parse(req.body);
    res.json({ url: await startCheckout(ws, body, deps) } satisfies RedirectResponse);
  });

  router.post('/api/billing/portal', async (req, res) => {
    const ws = requireWorkspace(req, res);
    if (!ws) return;
    res.json({ url: await openPortal(ws, deps) } satisfies RedirectResponse);
  });

  router.post('/api/billing/retry-payment', async (req, res) => {
    const ws = requireWorkspace(req, res);
    if (!ws) return;
    await retryPayment(ws, deps);
    res.status(202).json({ ok: true });
  });

  router.put('/api/workspace/employees', async (req, res) => {
    const ws = requireWorkspace(req, res);
    if (!ws) return;
    await setEmployees(ws, EmployeesBody.parse(req.body).employees, deps);
    res.json({ ok: true });
  });

  router.post('/api/events/:id/replay', (req, res) => {
    const ws = requireWorkspace(req, res);
    if (!ws) return;
    const event = store.event(req.params.id);
    if (!event || event.workspaceId !== ws.id) throw new AppError(404, 'Event not found');
    if (event.status === 'pending') throw new AppError(409, 'This event is already waiting to be processed.');
    // Replaying runs the same idempotent handler again: state is re-synced, emails aren't re-sent.
    store.requeueEvent(event.id, deps.now());
    deps.queue.kick();
    res.status(202).json({ ok: true });
  });

  router.post('/api/demo/advance-to-renewal', async (req, res) => {
    const ws = requireWorkspace(req, res);
    if (!ws) return;
    await advanceToRenewal(ws, deps);
    res.status(202).json({ ok: true });
  });

  router.put('/api/demo/card', async (req, res) => {
    const ws = requireWorkspace(req, res);
    if (!ws) return;
    await useTestCard(ws, CardBody.parse(req.body).card, deps);
    res.json({ ok: true });
  });

  // Domain errors become clean 4xx responses; anything else goes to the app's error handler.
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message } satisfies ApiErrorBody);
    } else if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request' } satisfies ApiErrorBody);
    } else if (err instanceof PaymentDeclinedError) {
      res.status(402).json({ error: `The card was declined: ${err.message}` } satisfies ApiErrorBody);
    } else {
      next(err);
    }
  });

  return router;
}
