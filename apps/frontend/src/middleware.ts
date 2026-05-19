import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const publicPaths = ['/login', '/register'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Exclude static files and api routes from middleware
  if (
    pathname.startsWith('/_next') || 
    pathname.startsWith('/api') || 
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get('auth_token');
  const isPublicPath = publicPaths.includes(pathname);

  // If trying to access protected route without token, redirect to login
  if (!token && !isPublicPath) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // If trying to access login/register while authenticated, redirect to dashboard
  if (token && isPublicPath) {
    return NextResponse.redirect(new URL('/projects', request.url));
  }

  // Redirect root to projects dashboard if authenticated
  if (pathname === '/' && token) {
    return NextResponse.redirect(new URL('/projects', request.url));
  }
  
  // Redirect root to login if not authenticated
  if (pathname === '/' && !token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
