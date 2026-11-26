// Sent with every response. Pages also get the full Content-Security-Policy, with a per-request
// nonce, from src/proxy.ts; this frame-ancestors one covers everything else (static files too).
const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // The admin sign-in has a memorable address of its own.
  async redirects() {
    return [{ source: '/admin/login', destination: '/login?as=admin', permanent: false }];
  },
  // API_PROXY_TARGET (e.g. https://openpm-api.<env>.azurecontainerapps.io), read at build time: serve the
  // API at this site's own /api, so the sign-in cookie belongs to the frontend's domain. For hosts
  // like Vercel, where the frontend and API cannot share a parent domain (docs/deploying.md). The
  // socket cannot be proxied this way; it goes straight to NEXT_PUBLIC_WS_URL with a ticket.
  async rewrites() {
    const target = process.env.API_PROXY_TARGET?.replace(/\/+$/, '');
    return target ? [{ source: '/api/:path*', destination: `${target}/api/:path*` }] : [];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
