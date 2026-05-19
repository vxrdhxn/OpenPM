import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import client from 'prom-client';

import { config } from './config';
import authPlugin from './plugins/auth';
import healthRoutes from './routes/health';
import metricsRoutes from './routes/metrics';
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import taskRoutes from './routes/tasks';
import websocketRoutes from './routes/websocket';

declare module 'fastify' {
  interface FastifyRequest {
    metrics: {
      start: [number, number];
    };
  }
}

// Initialize Prometheus metrics
client.collectDefaultMetrics();

const httpRequestDurationMicroseconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
});

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'code']
});

export const activeWebsocketConnections = new client.Gauge({
  name: 'active_websocket_connections',
  help: 'Number of active WebSocket connections',
});

const fastify = Fastify({
  logger: true,
  bodyLimit: 1048576, // 1MB request size limit
});

// Setup prometheus hooks
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

fastify.register(cors, {
  origin: config.CORS_ORIGIN,
  credentials: true,
});

fastify.register(cookie);

fastify.register(rateLimit, {
  max: 100, // 100 req/min general limit
  timeWindow: '1 minute'
});

fastify.register(websocket);

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

// Custom Auth Plugin
fastify.register(authPlugin);

// Register Routes
fastify.register(healthRoutes);
fastify.register(metricsRoutes);
fastify.register(authRoutes, { prefix: '/api/auth' });
fastify.register(projectRoutes, { prefix: '/api/projects' });
fastify.register(taskRoutes, { prefix: '/api/projects' }); // /:projectId/tasks
fastify.register(websocketRoutes);

// Graceful Shutdown on SIGTERM
// WHY: K8s sends SIGTERM before killing pods. Without it: in-flight requests drop.
// With it: finish current requests, exit cleanly.
const listeners = ['SIGINT', 'SIGTERM'];
listeners.forEach((signal) => {
  process.on(signal, async () => {
    fastify.log.info(`Received ${signal}. Shutting down gracefully...`);
    await fastify.close();
    process.exit(0);
  });
});

const start = async () => {
  try {
    await fastify.listen({ port: parseInt(config.PORT), host: '0.0.0.0' });
    // WHY 0.0.0.0: Inside Docker, external traffic cannot reach localhost. Must bind all interfaces.
    fastify.log.info(`Server is running on http://0.0.0.0:${config.PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
