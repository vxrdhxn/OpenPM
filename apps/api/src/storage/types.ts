/**
 * Object storage abstraction. Routes depend on this interface, never on an SDK, so the backing
 * store (AWS S3, MinIO, R2, ...) is a deployment choice and tests can substitute a fake.
 */
export interface ObjectStorage {
  /**
   * A short-lived URL the browser can PUT the file to directly. The signature binds the exact
   * Content-Type and Content-Length, so the upload must match what the API validated. The caller
   * must send every header in `headers`.
   */
  presignUpload(params: {
    key: string;
    contentType: string;
    size: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; headers: Record<string, string> }>;

  /** A short-lived URL that downloads the object as a file (never rendered inline). */
  presignDownload(params: { key: string; filename: string; expiresInSeconds: number }): Promise<string>;

  /** Size and content type of a stored object, or null if it does not exist. */
  head(key: string): Promise<{ size: number; contentType?: string } | null>;

  /** The first `bytes` bytes of an object (for content sniffing). */
  readPrefix(key: string, bytes: number): Promise<Uint8Array>;

  /** Delete an object. Succeeds if it is already gone. */
  delete(key: string): Promise<void>;
}
