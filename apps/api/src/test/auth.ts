import type { AuthPluginOptions } from '../plugins/auth';

/**
 * Auth plugin options for route unit tests, which mock the database: trust the token's claims
 * instead of checking the session against the users table. The real check (revocation, current
 * role) is tested in plugins/auth.session.test.ts and against Postgres in the integration suite.
 */
export const TRUST_TOKEN_CLAIMS: AuthPluginOptions = {
  verifySession: async (claims) => ({ role: claims.role }),
};
