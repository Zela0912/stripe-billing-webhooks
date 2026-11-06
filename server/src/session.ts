import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

const COOKIE = 'tidyshift_ws';
const MAX_AGE_SECONDS = 30 * 24 * 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Demo "login": each browser gets its own workspace, identified by a random id in an
 * HttpOnly cookie. A real app would use its existing auth here and look up the workspace
 * of the signed-in user; nothing else in the code would change.
 */
export function readWorkspaceId(req: Request): string | null {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) {
      const value = rest.join('=');
      return UUID.test(value) ? value : null;
    }
  }
  return null;
}

export function issueWorkspaceId(res: Response, secure: boolean): string {
  const id = randomUUID();
  const attributes = [`${COOKIE}=${id}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${MAX_AGE_SECONDS}`];
  if (secure) attributes.push('Secure');
  res.append('Set-Cookie', attributes.join('; '));
  return id;
}
