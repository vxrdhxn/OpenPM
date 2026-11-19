/**
 * A cached response body exactly as stored (JSON text). A route sends it as is, so a cache hit
 * costs no JSON.parse and no re-serialization (sendJson in routes/send.ts).
 */
export class CachedJson {
  constructor(readonly json: string) {}
}
