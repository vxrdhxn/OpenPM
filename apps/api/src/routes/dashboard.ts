import { FastifyPluginAsync } from 'fastify';
import { scopeOf } from '../data/scope';
import * as dashboard from '../data/dashboard';
import { paginationQuerySchema } from '../query/pagination';

/**
 * Read-only views, so the routes call the read models in data/dashboard.ts directly (there are no
 * rules for a service to hold).
 */

export { DASHBOARD_PROJECTS, FEED_ENTITY_TYPES } from '../data/dashboard';

/**
 * GET /api/dashboard: the numbers the dashboard leads with. The task lists on the dashboard come from
 * GET /api/tasks; the feed from GET /api/activity.
 */
export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  fastify.get('/', { preHandler: fastify.requireRole('viewer') }, async (request) => dashboard.summary(scopeOf(request.user)));
};

/** GET /api/activity: recent product activity, newest first, paginated; `project_id` narrows it to one project. */
export const activityRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  fastify.get<{ Querystring: { limit: number; cursor?: string; project_id?: string } }>('/', {
    preHandler: fastify.requireRole('viewer'),
    schema: {
      querystring: {
        type: 'object',
        properties: { ...paginationQuerySchema, project_id: { type: 'string', format: 'uuid' } },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const { limit, cursor, project_id } = request.query;
    return dashboard.activityFeed(scopeOf(request.user), { limit, cursor, projectId: project_id });
  });
};
