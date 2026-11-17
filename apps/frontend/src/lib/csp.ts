/**
 * The Content-Security-Policy for every page (docs/security-model.md). proxy.ts builds it per request
 * with a fresh nonce; Next.js reads the nonce from the request's CSP header and puts it on its own
 * scripts. Scripts run only with that nonce ('strict-dynamic' lets them load the app's chunks), so an
 * injected <script> or inline handler does not run, even if an XSS bug let one into a page.
 */

export interface CspOptions {
  nonce: string;
  /** `next dev` needs eval for fast refresh; production does not. */
  dev: boolean;
  /** NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL when the API is on another origin (Compose, dev). */
  apiUrl?: string;
  wsUrl?: string;
  /** The host the page is served from: its ws(s):// origin is allowed for the same-origin socket. */
  host: string;
  secure: boolean;
  /**
   * Extra origins the browser may connect to, space- or comma-separated: the object storage that
   * attachments upload to (S3_PUBLIC_ENDPOINT on the API). From CSP_CONNECT_SRC at runtime.
   */
  extraConnectSrc?: string;
}

/** The origin of an absolute URL, or null for a relative one ("/api") or garbage. */
export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return ['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
}

export function buildCsp(o: CspOptions): string {
  const connect = new Set<string>(["'self'", `${o.secure ? 'wss' : 'ws'}://${o.host}`]);
  for (const url of [o.apiUrl, o.wsUrl, ...(o.extraConnectSrc ?? '').split(/[\s,]+/)]) {
    const origin = originOf(url);
    if (origin) connect.add(origin);
  }
  if (o.dev) {
    // The dev server's API and socket (lib/endpoints.ts), and its hot-reload socket.
    connect.add('http://localhost:3000');
    connect.add('ws://localhost:3000');
  }

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${o.nonce}'`, "'strict-dynamic'", ...(o.dev ? ["'unsafe-eval'"] : [])],
    // Inline styles stay allowed: React's style attributes and the drag-and-drop library set them,
    // and nonces do not cover attributes. Styles cannot run code.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': [...connect],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

/** 128 random bits, base64: a nonce nobody can guess for the next response. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
