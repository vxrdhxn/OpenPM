import crypto from 'crypto';

/**
 * Invite tokens: 32 random bytes, hex-encoded. Only the SHA-256 hash is stored; the raw token travels
 * in the emailed link (and briefly in the job that sends it). A plain hash is enough here, unlike for
 * passwords: the token has 256 bits of entropy, so it cannot be brute-forced from its hash.
 */
export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: hashInviteToken(token) };
}
