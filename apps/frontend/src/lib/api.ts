import { apiBaseUrl } from './endpoints';

/** A non-2xx answer from the API: `message` is its `error`, `data` the whole JSON body (if any). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, any> | null
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Base API client
export async function fetchApi(endpoint: string, options: RequestInit = {}) {
  const url = `${apiBaseUrl()}${endpoint}`;
  
  const headers = new Headers(options.headers || {});
  // Only requests with a body are JSON. The API (Fastify) rejects a request that declares
  // application/json but sends no body with 400, which broke every DELETE from the UI.
  if (options.body !== undefined && options.body !== null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
    // Include cookies for JWT authentication
    credentials: 'include', 
  });

  // Handle 401 Unauthorized globally if possible (in client components)
  if (response.status === 401 && typeof window !== 'undefined') {
    if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
      // The session cookie was rejected (expired, or signed with a since-rotated secret). It is
      // httpOnly, so only the API can clear it. Without that, the server-side proxy, which only checks
      // that a cookie exists, sends /login straight back to the dashboard: an endless reload loop.
      // Plain fetch, not fetchApi, so a failing logout cannot recurse.
      await fetch(`${apiBaseUrl()}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
      // Deliberate hard navigation: fetchApi runs outside React, and a full reload drops stale client state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/login';
    }
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(data?.error || response.statusText || 'API Error', response.status, data);
  }

  return data;
}

export const api = {
  get: (endpoint: string, options?: RequestInit) => fetchApi(endpoint, { ...options, method: 'GET' }),
  post: (endpoint: string, data: any, options?: RequestInit) => fetchApi(endpoint, { ...options, method: 'POST', body: JSON.stringify(data) }),
  patch: (endpoint: string, data: any, options?: RequestInit) => fetchApi(endpoint, { ...options, method: 'PATCH', body: JSON.stringify(data) }),
  put: (endpoint: string, data: any, options?: RequestInit) => fetchApi(endpoint, { ...options, method: 'PUT', body: JSON.stringify(data) }),
  delete: (endpoint: string, options?: RequestInit) => fetchApi(endpoint, { ...options, method: 'DELETE' }),
};
