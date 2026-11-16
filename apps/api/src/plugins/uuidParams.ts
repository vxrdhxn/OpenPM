import fp from 'fastify-plugin';

/** Path parameters that hold a row id: `:id`, `:projectId`, `:taskId`, `:attachmentId`, ... */
export function isIdParam(name: string): boolean {
  return name === 'id' || /^[a-z][a-zA-Z0-9]*Id$/.test(name);
}

/** The parameter names in a route path, e.g. `/:projectId/tasks/:taskId` -> ['projectId', 'taskId']. */
export function pathParams(url: string): string[] {
  return [...url.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]!);
}

/**
 * Every id in this API is a UUID. Without a schema, a malformed id (`/api/projects/abc`) reached
 * Postgres, which rejected the cast (22P02) and the client got a 500. This gives each route that has
 * id parameters, and no params schema of its own, one that requires UUIDs, so the request fails
 * validation with a 400 before any handler or query runs.
 *
 * Registered before the routes (an onRoute hook only sees routes added after it). Authentication
 * runs in `preValidation`, so an unauthenticated request still gets 401, not 400.
 */
export default fp(async function uuidParams(fastify) {
  fastify.addHook('onRoute', (route) => {
    if (route.schema?.params) return;

    const ids = pathParams(route.url).filter(isIdParam);
    if (ids.length === 0) return;

    route.schema = {
      ...route.schema,
      params: {
        type: 'object',
        properties: Object.fromEntries(ids.map((name) => [name, { type: 'string', format: 'uuid' }])),
        required: ids,
      },
    };
  });
});
