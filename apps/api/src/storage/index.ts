import { config } from '../config';
import { createS3Storage } from './s3';
import type { ObjectStorage } from './types';

export type { ObjectStorage } from './types';

let instance: ObjectStorage | null | undefined;

/**
 * The configured object store, or null when attachments are not configured
 * (bucket and credentials are all required). Built lazily, once.
 */
export function getStorage(): ObjectStorage | null {
  if (instance !== undefined) return instance;

  const { S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = config;
  instance =
    S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
      ? createS3Storage({
          bucket: S3_BUCKET,
          region: config.S3_REGION,
          accessKeyId: S3_ACCESS_KEY_ID,
          secretAccessKey: S3_SECRET_ACCESS_KEY,
          endpoint: config.S3_ENDPOINT,
          publicEndpoint: config.S3_PUBLIC_ENDPOINT,
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
        })
      : null;
  return instance;
}
