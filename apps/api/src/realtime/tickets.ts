import { createHash, randomBytes } from 'node:crypto';
import { cache } from '../cache/redis';
import type { FastifyJWT } from '@fastify/jwt';

/**
 * WebSocket tickets (docs/realtime.md): a random, single-use, 30-second key a signed-in browser trades
 * for one socket. Needed when the frontend reaches the API through a proxy on its own domain (Vercel)
 * while the socket goes straight to the API's domain, where the SameSite=Strict cookie is not sent.
 *
 * Unlike a session token, a ticket is fine in the URL: it works once, for 30 seconds, and only Redis
 * holds it (as a hash, so a Redis dump does not hold usable tickets either).
 */

export const TICKET_TTL_SECONDS = 30;

/** The verified session the ticket was issued for. */
export type TicketClaims = FastifyJWT['user'];

const keyFor = (ticket: string) => `openpm:ws-ticket:${createHash('sha256').update(ticket).digest('hex')}`;

/** 256 random bits, base64url (43 characters). */
export const TICKET_PATTERN = '^[A-Za-z0-9_-]{43}$';
const ticketRe = new RegExp(TICKET_PATTERN);

/** A new ticket for these claims, or null when Redis cannot store it. */
export async function issueTicket(claims: TicketClaims): Promise<string | null> {
  const ticket = randomBytes(32).toString('base64url');
  const { user_id, org_id, role, tv, exp } = claims;
  const stored = await cache.put(keyFor(ticket), { user_id, org_id, role, tv, exp }, TICKET_TTL_SECONDS);
  return stored ? ticket : null;
}

/** The claims a ticket was issued for, once; null if it is malformed, unknown, used or expired. */
export async function redeemTicket(ticket: string): Promise<TicketClaims | null> {
  if (!ticketRe.test(ticket)) return null;
  return cache.take<TicketClaims>(keyFor(ticket));
}
