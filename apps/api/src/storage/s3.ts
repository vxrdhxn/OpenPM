import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { contentDisposition } from '../attachments/policy';
import type { ObjectStorage } from './types';

export interface S3StorageConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Endpoint the API itself uses (HEAD/GET/DELETE). Omit for AWS S3. */
  endpoint?: string;
  /** Endpoint baked into presigned URLs, i.e. what the BROWSER can reach. Defaults to `endpoint`. */
  publicEndpoint?: string;
  /** Required by MinIO and most self-hosted stores. */
  forcePathStyle?: boolean;
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

export function createS3Storage(cfg: S3StorageConfig): ObjectStorage {
  const base = {
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    forcePathStyle: cfg.forcePathStyle ?? false,
    // The SDK's default adds `x-amz-checksum-crc32` (the checksum of an EMPTY body) to presigned
    // PUT URLs, which makes every real browser upload fail integrity validation. Only compute
    // checksums when an operation requires them.
    requestChecksumCalculation: 'WHEN_REQUIRED' as const,
    responseChecksumValidation: 'WHEN_REQUIRED' as const,
  };

  // Presigning is purely local (no network), so it can use the browser-facing endpoint while the
  // API talks to storage over the internal one.
  const internal = new S3Client({ ...base, endpoint: cfg.endpoint });
  const presigner = new S3Client({ ...base, endpoint: cfg.publicEndpoint ?? cfg.endpoint });

  return {
    async presignUpload({ key, contentType, size, expiresInSeconds }) {
      const url = await getSignedUrl(
        presigner,
        new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: contentType, ContentLength: size }),
        {
          expiresIn: expiresInSeconds,
          // By default only content-length is signed. Also sign content-type so the stored object
          // carries exactly the type the API validated, not whatever the client chooses to send.
          signableHeaders: new Set(['content-type']),
        }
      );
      return { url, headers: { 'Content-Type': contentType } };
    },

    presignDownload({ key, filename, expiresInSeconds }) {
      return getSignedUrl(
        presigner,
        new GetObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          // Force a download. Without this a browser could render an uploaded file in our origin.
          ResponseContentDisposition: contentDisposition(filename),
        }),
        { expiresIn: expiresInSeconds }
      );
    },

    async head(key) {
      try {
        const res = await internal.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
        return { size: res.ContentLength ?? 0, contentType: res.ContentType };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async readPrefix(key, bytes) {
      const res = await internal.send(
        new GetObjectCommand({ Bucket: cfg.bucket, Key: key, Range: `bytes=0-${Math.max(bytes, 1) - 1}` })
      );
      return (await res.Body?.transformToByteArray()) ?? new Uint8Array();
    },

    async delete(key) {
      // S3 DeleteObject is idempotent: deleting a missing key succeeds.
      await internal.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
  };
}
