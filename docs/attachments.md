# Task attachments

Files are attached to tasks and stored in any **S3-compatible** object store (AWS S3, MinIO,
Cloudflare R2, ...). The browser uploads and downloads **directly to/from storage** using
short-lived presigned URLs; the API only checks permissions, issues URLs and records metadata, so it
never proxies file bytes.

Attachments are optional. Until storage is configured, every attachment endpoint returns `503`.

## Configuration

| Variable | Required | Notes |
|---|---|---|
| `S3_BUCKET` | yes | Must already exist. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | yes | Deliberately no defaults. If any of the three above is unset, attachments are off. |
| `S3_REGION` | no | Default `us-east-1`. |
| `S3_ENDPOINT` | MinIO/others | Endpoint the **API** uses (`HEAD`/`GET`/`DELETE`). Omit for AWS S3. |
| `S3_PUBLIC_ENDPOINT` | when different | Endpoint the **browser** can reach; baked into presigned URLs. Defaults to `S3_ENDPOINT`. Needed in Docker/K8s where the API uses an internal hostname. |
| `S3_FORCE_PATH_STYLE` | MinIO/others | `true` for path-style addressing. |
| `ATTACHMENT_MAX_BYTES` | no | Default `10485760` (10 MiB). |

Blank values (as in `.env.example`) are treated as unset.

**The frontend must allow the storage origin** in its Content-Security-Policy, or the browser blocks
uploads: set `CSP_CONNECT_SRC` (Helm: `frontend.cspConnectSrc`) to the origin of
`S3_PUBLIC_ENDPOINT`, e.g. `https://files.example.com` ([deploying.md](deploying.md)). Downloads are
navigations and need nothing.

### Bucket CORS (required)

Browsers upload and download across origins, so the bucket must allow your frontend origin. For AWS S3:

```json
[{
  "AllowedOrigins": ["https://openpm.example.com"],
  "AllowedMethods": ["PUT", "GET"],
  "AllowedHeaders": ["*"],
  "MaxAgeSeconds": 3000
}]
```

For MinIO set `MINIO_API_CORS_ALLOW_ORIGIN` to your frontend origin (see `docker-compose.storage.yml`).

### Local development with MinIO

```bash
docker compose -f docker-compose.yml -f docker-compose.storage.yml up
```

`docker-compose.storage.yml` is opt-in. MinIO no longer publishes images to Docker Hub or quay.io, so it
uses Chainguard's maintained build (`cgr.dev/chainguard/minio`), which also provides `mc` for the bucket-init
step. The image is overridable with `MINIO_IMAGE` (any image with `minio`, `mc` and `sh`); Chainguard's free
tier only publishes `latest`, so pin a digest for reproducible runs (see the comment in the file).

Verified in a real browser (Chrome) against MinIO during the full-stack rehearsal ([rehearsal.md](rehearsal.md)): upload from the task dialog, download from the page, delete from the UI. Earlier, with scripted requests: browser-style CORS preflight, presigned upload, completion, download with
forced-download headers, and object removal on delete.

## API

All routes are under `/api/projects/:projectId/tasks/:taskId/attachments` and are scoped to the
caller's organization (a task, project or attachment from another org is simply `404`).

| Method | Path | Role | Purpose |
|---|---|---|---|
| `POST` | `/` | member+ | Validate metadata, create a `pending` row, return a presigned upload. |
| `POST` | `/:attachmentId/complete` | uploader or admin+ | Verify the stored object and mark it `ready`. |
| `GET` | `/` | viewer+ | List `ready` attachments. |
| `GET` | `/:attachmentId/download` | viewer+ | Short-lived download URL (`ready` only). |
| `DELETE` | `/:attachmentId` | uploader or admin+ | Remove metadata and the stored object. |

### Upload flow

```ts
// 1. Ask for an upload URL (declare what you are about to send).
const { attachment, upload } = await api.post(`/projects/${p}/tasks/${t}/attachments`, {
  filename: file.name, content_type: file.type, size: file.size,
});

// 2. Upload straight to storage. Send exactly the returned headers; the signature binds them.
await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });

// 3. Tell the API it is done; it verifies the object before marking it ready.
await api.post(`/projects/${p}/tasks/${t}/attachments/${attachment.id}/complete`, {});
```

The upload URL is valid for 5 minutes; download URLs for 2 minutes.

## Rules enforced

- **Allowlist.** PNG, JPEG, GIF, WebP, PDF, plain text, CSV, Markdown, JSON, DOCX, XLSX, PPTX. The
  content type must match exactly (no parameters) and the filename extension must match the type.
  Active content (HTML, SVG, scripts, executables, archives) is not allowed.
- **Size.** `1` to `ATTACHMENT_MAX_BYTES` bytes, and at most 25 attachments per task. The size is
  signed into the upload URL, so storage rejects an upload of a different size.
- **Content type is signed too**, so the stored object carries the type the API validated.
- **Verified on completion.** The stored size and type must match what was declared, and the file's
  leading bytes must match its type (e.g. a renamed `.exe` is rejected). Rejected files are deleted.
- **Filenames** are sanitized for display (directory parts, control and bidi characters removed).
  Storage keys are random (`org/<org>/tasks/<task>/<uuid>`) and contain no user input.
- **Downloads are always attachments** (`Content-Disposition: attachment`), never rendered inline.
- **Storage keys are never returned** by the API.

## Files outside the database: nothing is forgotten

Deleting an attachment, a task, a project or a whole organization deletes the rows in a transaction
that also records their storage keys in `storage_deletions` (migration 028). After the commit the API
deletes the objects and clears the keys. A delete that fails, or never runs (storage down, the pod
stopped between commit and delete), stays owed. A rollback never deletes a file that is still
referenced.

Every API pod runs a **storage sweep** every 15 minutes (`apps/api/src/attachments/cleanup.ts`):

- **Owed deletions** that are due are retried, backing off from 5 minutes up to a day per key.
- **Abandoned uploads**, still `pending` an hour after they started (the upload URL lives 5 minutes),
  are removed along with any object a client did upload.

`FOR UPDATE SKIP LOCKED` lets the pods sweep at once without working on the same key. Metrics:
`storage_deletions_total{result}`, `storage_deletions_owed` (a growing number means storage keeps
refusing deletes: check credentials and bucket permissions) and `abandoned_uploads_reaped_total`.
Tested against Postgres in `apps/api/src/test/integration/storageCleanup.int.test.ts`.

## Retention

An attachment is kept as long as its task. It is deleted with the task, its project or its
organization, or by whoever may delete it (the uploader or an admin). There is no age-based expiry.

## Malware scanning: strategy

OpenPM does not scan files itself. Uploads go straight from the browser to the bucket, so scanning
belongs there:

- **What OpenPM already does:** a type allowlist (no executables, scripts or HTML), the first bytes
  must match the declared type, a size limit, randomized storage keys, and downloads that are always
  `Content-Disposition: attachment` from a different origin, so a file is never rendered in the app.
- **What to add in production:** your storage provider's scanner on the bucket, for example Amazon
  GuardDuty Malware Protection for S3, or a ClamAV job triggered by bucket events. Have it delete or
  quarantine infected objects. A quarantined file then fails to download, and its attachment can be
  removed in the app.

## Not covered yet

- Attachment quotas per organization.
- **Browser verification.** The UI (click a task card to open it) has been type-checked, built and
  unit-tested for its upload logic, but not run in a browser against real storage. Do that, and
  confirm the bucket CORS rules above, before relying on it.
