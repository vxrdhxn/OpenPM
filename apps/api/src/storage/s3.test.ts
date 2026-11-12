import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createS3Storage } from './s3';
import { contentDisposition } from '../attachments/policy';

const base = {
  bucket: 'openpm-attachments',
  region: 'us-east-1',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  endpoint: 'http://minio:9000',
  publicEndpoint: 'http://localhost:9000',
  forcePathStyle: true,
};

describe('createS3Storage: presigned URLs (real SDK, offline)', () => {
  const storage = createS3Storage(base);
  const KEY = 'org/o1/tasks/t1/0b3f2c1e-aaaa-bbbb-cccc-1234567890ab';

  it('presigned upload: uses the browser-facing endpoint, path style, and the given key', async () => {
    const { url } = await storage.presignUpload({ key: KEY, contentType: 'image/png', size: 123, expiresInSeconds: 300 });
    const u = new URL(url);

    expect(u.origin).toBe('http://localhost:9000'); // NOT the internal http://minio:9000
    expect(u.pathname).toBe(`/openpm-attachments/${KEY}`);
    expect(u.searchParams.get('X-Amz-Expires')).toBe('300');
  });

  it('presigned upload: signs both Content-Length (size limit) and Content-Type', async () => {
    const { url, headers } = await storage.presignUpload({ key: KEY, contentType: 'image/png', size: 123, expiresInSeconds: 300 });
    const signed = new URL(url).searchParams.get('X-Amz-SignedHeaders')!.split(';');

    expect(signed).toContain('content-length');
    expect(signed).toContain('content-type'); // otherwise the client could store any type
    expect(headers).toEqual({ 'Content-Type': 'image/png' });
  });

  it('presigned upload: carries no checksum parameters (SDK default would break real uploads)', async () => {
    const { url } = await storage.presignUpload({ key: KEY, contentType: 'image/png', size: 123, expiresInSeconds: 300 });
    const names = [...new URL(url).searchParams.keys()].map((k) => k.toLowerCase());

    expect(names.filter((n) => n.includes('checksum'))).toEqual([]);
  });

  it('presigned upload: different sizes produce different signatures (size is bound)', async () => {
    const a = await storage.presignUpload({ key: KEY, contentType: 'image/png', size: 100, expiresInSeconds: 300 });
    const b = await storage.presignUpload({ key: KEY, contentType: 'image/png', size: 101, expiresInSeconds: 300 });
    const sig = (url: string) => new URL(url).searchParams.get('X-Amz-Signature');

    expect(sig(a.url)).not.toBe(sig(b.url));
  });

  it('presigned upload: different content types produce different signatures (type is bound)', async () => {
    const a = await storage.presignUpload({ key: KEY, contentType: 'image/png', size: 100, expiresInSeconds: 300 });
    const b = await storage.presignUpload({ key: KEY, contentType: 'text/plain', size: 100, expiresInSeconds: 300 });
    const sig = (url: string) => new URL(url).searchParams.get('X-Amz-Signature');

    expect(sig(a.url)).not.toBe(sig(b.url));
  });

  it('presigned download: forces a download with a safe Content-Disposition', async () => {
    const url = new URL(await storage.presignDownload({ key: KEY, filename: 'résumé "final".pdf', expiresInSeconds: 120 }));

    expect(url.origin).toBe('http://localhost:9000');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120');
    expect(url.searchParams.get('response-content-disposition')).toBe(contentDisposition('résumé "final".pdf'));
    expect(url.searchParams.get('response-content-disposition')).toMatch(/^attachment; /);
  });

  it('falls back to the internal endpoint when no public endpoint is set', async () => {
    const plain = createS3Storage({ ...base, publicEndpoint: undefined });
    const { url } = await plain.presignUpload({ key: KEY, contentType: 'image/png', size: 1, expiresInSeconds: 60 });

    expect(new URL(url).origin).toBe('http://minio:9000');
  });

  it('uses AWS virtual-hosted addressing when no endpoint is configured', async () => {
    const aws = createS3Storage({ ...base, endpoint: undefined, publicEndpoint: undefined, forcePathStyle: false });
    const { url } = await aws.presignUpload({ key: KEY, contentType: 'image/png', size: 1, expiresInSeconds: 60 });

    expect(new URL(url).hostname).toBe('openpm-attachments.s3.us-east-1.amazonaws.com');
  });

  it('never embeds the secret key in a URL', async () => {
    const { url } = await storage.presignUpload({ key: KEY, contentType: 'image/png', size: 1, expiresInSeconds: 60 });
    expect(url).not.toContain('test-secret');
  });
});

describe('createS3Storage: object operations', () => {
  const storage = createS3Storage(base);
  let send: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    send = vi.spyOn(S3Client.prototype, 'send') as unknown as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sentCommand = () => (send.mock.calls[0] as unknown[])[0];

  it('head: returns size and content type', async () => {
    send.mockResolvedValue({ ContentLength: 42, ContentType: 'image/png' } as never);

    expect(await storage.head('k')).toEqual({ size: 42, contentType: 'image/png' });
    expect(sentCommand()).toBeInstanceOf(HeadObjectCommand);
    expect((sentCommand() as HeadObjectCommand).input).toMatchObject({ Bucket: 'openpm-attachments', Key: 'k' });
  });

  it.each([
    ['NotFound by name', { name: 'NotFound' }],
    ['NoSuchKey by name', { name: 'NoSuchKey' }],
    ['404 by status', { name: 'Other', $metadata: { httpStatusCode: 404 } }],
  ])('head: returns null for a missing object (%s)', async (_label, error) => {
    send.mockRejectedValue(error as never);
    expect(await storage.head('missing')).toBeNull();
  });

  it('head: rethrows real failures instead of reporting "missing"', async () => {
    send.mockRejectedValue({ name: 'AccessDenied', $metadata: { httpStatusCode: 403 } } as never);
    await expect(storage.head('k')).rejects.toMatchObject({ name: 'AccessDenied' });
  });

  it('readPrefix: requests only the leading bytes and returns them', async () => {
    send.mockResolvedValue({ Body: { transformToByteArray: async () => Uint8Array.from([1, 2, 3]) } } as never);

    expect(await storage.readPrefix('k', 16)).toEqual(Uint8Array.from([1, 2, 3]));
    expect(sentCommand()).toBeInstanceOf(GetObjectCommand);
    expect((sentCommand() as GetObjectCommand).input.Range).toBe('bytes=0-15');
  });

  it('readPrefix: tolerates an empty body', async () => {
    send.mockResolvedValue({} as never);
    expect(await storage.readPrefix('k', 16)).toEqual(new Uint8Array());
  });

  it('delete: sends DeleteObject for the key', async () => {
    send.mockResolvedValue({} as never);

    await storage.delete('k');

    expect(sentCommand()).toBeInstanceOf(DeleteObjectCommand);
    expect((sentCommand() as DeleteObjectCommand).input).toMatchObject({ Bucket: 'openpm-attachments', Key: 'k' });
  });
});
