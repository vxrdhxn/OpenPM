import { cache } from '../cache/redis';

/** Live clients reload who may see what (routes/websocket.ts) and refresh the project. */
export const announceAccessChange = (orgId: string, projectId: string) =>
  cache.publish(`org:${orgId}:updates`, { type: 'project_access_changed', project_id: projectId });
