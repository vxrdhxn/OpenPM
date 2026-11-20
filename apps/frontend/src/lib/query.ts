export type QueryValue = string | number | undefined | null | readonly string[];

/**
 * A query string for the API's list endpoints: empty values are left out and arrays repeat the key
 * (`?priority=high&priority=urgent`), which is how the API takes multiple values.
 */
export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) if (v !== '') search.append(key, v);
    } else {
      search.append(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export type { Page } from '@openpm/wire';
