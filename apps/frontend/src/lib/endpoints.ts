/**
 * Where the browser finds the API and the realtime socket.
 *
 * NEXT_PUBLIC_* values are inlined when the frontend is BUILT, not read at runtime, so a container's
 * environment cannot change them. Defaults therefore have to work for a generic image:
 *
 * - Production build, nothing set: same origin. The Helm chart's Ingress serves the frontend, /api and
 *   /ws on one host, so `/api` and `ws(s)://<this host>/ws` are right for every domain without a rebuild.
 * - `npm run dev`: the API on localhost:3000 next to the dev server.
 * - Anything else (e.g. Docker Compose, where frontend and API use different ports): set
 *   NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL at build time (Compose passes them as build args).
 */

const isDev = () => process.env.NODE_ENV === 'development';

export function apiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  return isDev() ? 'http://localhost:3000/api' : '/api';
}

export function websocketUrl(location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (isDev()) return 'ws://localhost:3000/ws';
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
}
