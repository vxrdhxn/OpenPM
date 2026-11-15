import crypto from 'crypto';

/**
 * Single-use secrets sent by email (invite links, password-reset links): 32 random bytes, hex-encoded.
 * Only the SHA-256 hash is stored; the raw token travels in the emailed link (and briefly in the job
 * that sends it). A plain hash is enough here, unlike for passwords: with 256 bits of entropy the
 * token cannot be brute-forced from its hash.
 */
export const TOKEN_PATTERN = '^[0-9a-f]{64}$';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: hashToken(token) };
}
