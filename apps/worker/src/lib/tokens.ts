import crypto from 'crypto';

/** SHA-256 of an emailed token, matching how the API stores it (apps/api/src/security/tokens.ts). */
export const hashToken = (token: string) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');
