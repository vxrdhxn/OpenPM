import { FastifyPluginAsync } from 'fastify';
import { scopeOf } from '../data/scope';
import * as taskSearch from '../data/taskSearch';
import type { TaskSearchQuery } from '../data/taskSearch';
import { paginationQuerySchema } from '../query/pagination';
import { taskFilterQuerySchema } from '../query/taskFilters';

/**
 * GET /api/tasks: search tasks across the organization's projects (e.g. "assigned to me, due this
 * week, most urgent first"). Paginated with a cursor; response `{ items, next_cursor }`.
 *
 *   ?assignee=me&status=todo&status=in_progress&sort=due_date&order=asc&limit=20
 */
const taskSearchRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  fastify.get<{ Querystring: TaskSearchQuery }>('/', {
    preHandler: fastify.requireRole('viewer'),
    schema: {
      querystring: {
        type: 'object',
        properties: {
          ...taskFilterQuerySchema,
          ...paginationQuerySchema,
          project_id: { type: 'string', format: 'uuid' },
          sort: { type: 'string', enum: ['created_at', 'updated_at', 'due_date', 'priority'], default: 'created_at' },
          order: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => taskSearch.search(scopeOf(request.user), request.query));
};

export default taskSearchRoutes;
