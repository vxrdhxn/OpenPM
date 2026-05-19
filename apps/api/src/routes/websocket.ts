import { FastifyPluginAsync } from 'fastify';
import { cache } from '../cache/redis';

const websocketRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/ws', { websocket: true }, async (connection, request) => {
    const { token } = request.query as { token?: string };
    
    if (!token) {
      connection.socket.close(1008, 'Token required');
      return;
    }

    try {
      const decoded = fastify.jwt.verify(token) as any;
      const orgId = decoded.org_id;

      const channelName = `org:${orgId}:updates`;
      fastify.log.info(`WS Client connected and subscribing to ${channelName}`);

      // Subscribe to Redis channel for this org
      const unsubscribe = await cache.subscribe(channelName, (message) => {
        if (connection.socket.readyState === 1) { // OPEN
          connection.socket.send(JSON.stringify(message));
        }
      });

      connection.socket.on('close', () => {
        fastify.log.info(`WS Client disconnected from ${channelName}`);
        unsubscribe(); // Unsubscribe to prevent memory leaks
      });

    } catch (err) {
      fastify.log.error(err, 'Invalid WS token');
      connection.socket.close(1008, 'Invalid token');
    }
  });
};

export default websocketRoutes;
