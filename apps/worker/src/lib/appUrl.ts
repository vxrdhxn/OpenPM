/**
 * Base URL of the frontend, used to build links in emails (invites, password resets). Required in
 * production: silently emailing a localhost link would look sent but be useless, so the job fails
 * visibly instead.
 */
export function appUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.APP_URL?.trim();
  if (url) return url.replace(/\/+$/, '');
  if (env.NODE_ENV === 'production') {
    throw new Error('APP_URL is not set; cannot build links in emails');
  }
  return 'http://localhost:3001';
}
