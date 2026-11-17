import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import type { Redis } from 'ioredis';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { config, trustProxySetting } from './config';
import { corsOptions } from './corsOptions';
import { httpRequestDurationMicroseconds, httpRequestsTotal } from './metrics';
import { genReqId, loggerOptions } from './logger';
import requestIdPlugin from './plugins/requestId';
import errorHandling from './plugins/errors';
import uuidParams from './plugins/uuidParams';
import textInput from './plugins/textInput';
import { parseAllowlist } from './security/rateLimitAllowlist';
import authPlugin from './plugins/auth';
import healthRoutes from './routes/health';
import metricsRoutes from './routes/metrics';
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import taskRoutes from './routes/tasks';
import attachmentRoutes from './routes/attachments';
import websocketRoutes from './routes/websocket';
import profileRoutes from './routes/profile';
import inviteRoutes from './routes/invites';
import memberRoutes from './routes/members';
import taskSearchRoutes from './routes/taskSearch';
import commentRoutes from './routes/comments';
import { labelRoutes, taskLabelRoutes } from './routes/labels';
import { activityRoutes, dashboardRoutes } from './routes/dashboard';
import notificationRoutes from './routes/notifications';
import organizationRoutes from './routes/organization';
import projectMemberRoutes from './routes/projectMembers';
import auditRoutes from './routes/audit';
import { canSeeProject } from './security/projectAccess';

declare module 'fastify' {
  interface FastifyRequest {
    metrics: {
      start: [number, number];
    };
  }
}

export interface BuildAppOptions {
  /** Fastify logger setting; defaults to the JSON production logger. Tests pass `false`. */
  logger?: FastifyServerOptions['logger'];
  /**
   * Redis connection for rate-limit counters shared by every API instance (security/rateLimitStore.ts).
   * index.ts passes one; without it each instance counts on its own (tests).
   */
  rateLimitRedis?: Redis;
}

/**
 * The API with every plugin and route registered, but not listening. index.ts starts it; integration
 * tests drive it with `app.inject()` against a real database.
 */
export function buildApp(options: BuildAppOptions = {}) {
  const fastify = Fastify({
    logger: options.logger ?? loggerOptions,
    genReqId,
    logController: new LogController({ requestIdLogLabel: 'request_id' }),
    bodyLimit: 1048576, // 1MB request size limit
    // Time a client gets to send a complete request (headers and body). Node's default is 5 minutes,
    // which lets slow clients hold connections open (slowloris). Upgraded WebSockets are not
    // affected. Slow handlers are bounded separately by the database statement_timeout.
    requestTimeout: 30_000,
    // Behind an Ingress every request arrives from the proxy; without this, all users would share one
    // rate-limit bucket. Off unless TRUST_PROXY is set (the Helm chart sets it), so direct clients
    // cannot choose their own address with X-Forwarded-For.
    trustProxy: trustProxySetting(),
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });

  // One error shape for every response, and no internal messages in 5xx bodies (plugins/errors.ts).
  fastify.register(errorHandling);

  // Must come before the routes: rejects non-UUID ids with a 400 (plugins/uuidParams.ts).
  fastify.register(uuidParams);

  // Requests carrying a NUL character are a 400 before any handler runs (plugins/textInput.ts).
  fastify.register(textInput);

  // Prometheus request metrics
  fastify.addHook('onRequest', (request, _reply, done) => {
    request.metrics = {
      start: process.hrtime()
    };
    done();
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    const diff = process.hrtime(request.metrics.start);
    const duration = diff[0] + diff[1] / 1e9;
    const route = request.routeOptions.url || 'unknown';

    if (route !== '/metrics') {
      httpRequestDurationMicroseconds.labels(request.method, route, reply.statusCode.toString()).observe(duration);
      httpRequestsTotal.labels(request.method, route, reply.statusCode.toString()).inc();
    }
    done();
  });

  // Register Plugins
  fastify.register(helmet, {
    contentSecurityPolicy: false // Usually configured based on frontend needs, keeping default for API
  });

  fastify.register(cors, corsOptions(config.CORS_ORIGIN));

  fastify.register(cookie);

  // Exempt addresses (load tests only; empty by default). Route-level limits inherit this too.
  const exempt = parseAllowlist(config.RATE_LIMIT_ALLOWLIST);
  if (exempt) {
    fastify.log.warn({ allowlist: config.RATE_LIMIT_ALLOWLIST }, 'RATE_LIMIT_ALLOWLIST is set: these clients are not rate-limited. Never use this in production.');
  }

  fastify.register(rateLimit, {
    max: 100, // 100 req/min general limit
    timeWindow: '1 minute',
    // Counted in Redis when given, so the limits hold across pods. If Redis fails, let the request
    // through: an outage turns rate limiting off rather than the API.
    ...(options.rateLimitRedis && { redis: options.rateLimitRedis, nameSpace: 'openpm:rate-limit:', skipOnError: true }),
    ...(exempt && { allowList: (request: { ip: string }) => exempt(request.ip) }),
  });

  fastify.register(websocket, {
    // Clients never send messages (routes/websocket.ts closes the socket on one); this bounds what
    // ws buffers before that happens. Larger frames close the socket with 1009.
    options: { maxPayload: 4096 },
    // On shutdown, tell connected clients this is a restart (1001 Going Away), not a broken
    // connection: the default closes without a code (1005). Clients reconnect either way (the
    // frontend retries everything except 1008); see docs/load-testing.md, failure test 4.
    preClose(this: { websocketServer: { clients?: Set<{ close(code: number, reason: string): void }>; close(): void } }, done: () => void) {
      for (const client of this.websocketServer.clients ?? []) client.close(1001, 'Server restarting');
      this.websocketServer.close();
      done();
    },
  });

  if (config.NODE_ENV !== 'production') {
    fastify.register(swagger, {
      swagger: {
        info: {
          title: 'OpenPM API',
          version: '0.1.0'
        },
        host: 'localhost:3000',
        schemes: ['http'],
        consumes: ['application/json'],
        produces: ['application/json'],
      }
    });

    fastify.register(swaggerUi, {
      routePrefix: '/docs',
    });
  }

  // Request ids (X-Request-Id in/out) must be registered before the routes
  fastify.register(requestIdPlugin);

  // Custom Auth Plugin
  fastify.register(authPlugin);

  // Register Routes
  // Private projects (docs/projects.md): every route under /api/projects/:projectId or
  // /api/projects/:id answers 404 to someone who cannot see that project, before the route runs.
  // One gate for tasks, comments, attachments, labels and members alike; tests/projectRoutes checks
  // that every such route names its project parameter one of these two ways.
  fastify.addHook('preHandler', async (request, reply) => {
    const url = request.routeOptions.url ?? '';
    if (!url.startsWith('/api/projects/:') || !request.user) return;
    const params = request.params as Record<string, string | undefined>;
    const projectId = params.projectId ?? params.id;
    if (!projectId) return;
    if (!(await canSeeProject(request.user, projectId))) {
      return reply.code(404).send({ error: 'Project not found' });
    }
  });

  fastify.register(healthRoutes);
  fastify.register(metricsRoutes);
  fastify.register(authRoutes, { prefix: '/api/auth' });
  fastify.register(projectRoutes, { prefix: '/api/projects' });
  fastify.register(taskRoutes, { prefix: '/api/projects' }); // /:projectId/tasks
  fastify.register(attachmentRoutes, { prefix: '/api/projects' }); // /:projectId/tasks/:taskId/attachments
  fastify.register(projectMemberRoutes, { prefix: '/api/projects' }); // /:projectId/members
  fastify.register(commentRoutes, { prefix: '/api/projects' }); // /:projectId/tasks/:taskId/comments
  fastify.register(taskLabelRoutes, { prefix: '/api/projects' }); // /:projectId/tasks/:taskId/labels
  fastify.register(labelRoutes, { prefix: '/api/labels' });
  fastify.register(dashboardRoutes, { prefix: '/api/dashboard' });
  fastify.register(activityRoutes, { prefix: '/api/activity' });
  fastify.register(notificationRoutes, { prefix: '/api/notifications' });
  fastify.register(profileRoutes, { prefix: '/api/profile' });
  fastify.register(inviteRoutes, { prefix: '/api/invites' });
  fastify.register(memberRoutes, { prefix: '/api/members' });
  fastify.register(organizationRoutes, { prefix: '/api/organization' });
  fastify.register(auditRoutes, { prefix: '/api/audit' });
  fastify.register(taskSearchRoutes, { prefix: '/api/tasks' });
  fastify.register(websocketRoutes);

  return fastify;
}
