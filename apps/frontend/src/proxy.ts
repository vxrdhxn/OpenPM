import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { buildCsp, newNonce } from './lib/csp';

// Only for signed-out users: signed-in users are sent to the dashboard.
const publicPaths = ['/login', '/register'];
// Reachable whether or not you are signed in: these are opened from links in emails.
const openPaths = ['/invite', '/forgot-password', '/reset-password'];

/**
 * Render the page with a per-request Content-Security-Policy (lib/csp.ts). The policy goes on the
 * request too: Next.js takes the nonce from it and adds it to the scripts it renders.
 */
function render(request: NextRequest) {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const csp = buildCsp({
    nonce: newNonce(),
    dev: process.env.NODE_ENV === 'development',
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    wsUrl: process.env.NEXT_PUBLIC_WS_URL,
    host: request.headers.get('x-forwarded-host') ?? request.nextUrl.host,
    secure: (forwardedProto ?? request.nextUrl.protocol.replace(':', '')) === 'https',
    extraConnectSrc: process.env.CSP_CONNECT_SRC,
  });

  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static files and API routes: no page, no policy needed (next.config.mjs still sets the others).
  if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname.includes('.')) {
    return NextResponse.next();
  }

  if (openPaths.includes(pathname)) {
    return render(request);
  }

  const token = request.cookies.get('auth_token');
  const isPublicPath = publicPaths.includes(pathname);

  // If trying to access protected route without token, redirect to login
  if (!token && !isPublicPath) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // If trying to access login/register while authenticated, redirect to dashboard
  if (token && isPublicPath) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Redirect root to the dashboard if authenticated
  if (pathname === '/' && token) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return render(request);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
