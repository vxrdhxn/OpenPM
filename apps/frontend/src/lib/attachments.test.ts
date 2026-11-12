import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
// Relative import on purpose: the client's type map must match the server's allowlist exactly.
import { ALLOWED_TYPES } from '../../../api/src/attachments/policy';
import {
  ACCEPT,
  ApiLike,
  AttachmentError,
  PutArgs,
  CONTENT_TYPE_BY_EXTENSION,
  attachmentsPath,
  contentTypeFor,
  deleteAttachment,
  extensionOf,
  formatBytes,
  getDownloadUrl,
  listAttachments,
  uploadAttachment,
} from './attachments';

const P = 'proj-1';
const T = 'task-1';
const BASE = `/projects/${P}/tasks/${T}/attachments`;

describe('content types', () => {
  it('stays in sync with the server allowlist (apps/api/src/attachments/policy.ts)', () => {
    const server = new Map<string, string>();
    for (const [type, def] of Object.entries(ALLOWED_TYPES)) {
      for (const ext of def.extensions) server.set(ext, type);
    }

    expect(Object.fromEntries(server)).toEqual(CONTENT_TYPE_BY_EXTENSION);
  });

  it.each([
    ['photo.PNG', 'image/png'],
    ['report.final.pdf', 'application/pdf'],
    ['notes.md', 'text/markdown'],
    ['data.csv', 'text/csv'],
    ['a.jpeg', 'image/jpeg'],
  ])('derives the type for %s from its extension', (name, type) => {
    expect(contentTypeFor(name)).toBe(type);
  });

  it.each(['run.exe', 'page.html', 'icon.svg', 'script.js', 'archive.zip', 'noextension', '.png', 'trailing.'])(
    'rejects %j',
    (name) => {
      expect(contentTypeFor(name)).toBeNull();
    }
  );

  it('exposes an accept list covering exactly the supported extensions', () => {
    expect(ACCEPT.split(',').sort()).toEqual(Object.keys(CONTENT_TYPE_BY_EXTENSION).map((e) => `.${e}`).sort());
  });

  it('parses extensions case-insensitively', () => {
    expect(extensionOf('A.TXT')).toBe('txt');
    expect(extensionOf('.bashrc')).toBe('');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [10 * 1024, '10 KB'],
    [1024 * 1024, '1 MB'],
    [5.5 * 1024 * 1024, '5.5 MB'],
    ['2048', '2 KB'], // BIGINT arrives as a string
    [3 * 1024 ** 3, '3 GB'],
    [5000 * 1024 ** 3, '5000 GB'], // capped at GB
  ])('%s -> %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it.each([-1, NaN, 'abc'])('returns an empty string for %s', (input) => {
    expect(formatBytes(input)).toBe('');
  });
});

describe('uploadAttachment', () => {
  const file = (name = 'diagram.png', content = 'x'.repeat(123), type = '') => new File([content], name, { type });
  const upload = { method: 'PUT', url: 'https://storage.test/put?sig=1', headers: { 'Content-Type': 'image/png' } };
  const created = { attachment: { id: 'att-1', status: 'pending' }, upload };
  const ready = { id: 'att-1', status: 'ready', filename: 'diagram.png' };

  type PutMock = Mock<[PutArgs], Promise<void>>;

  function setup(over: Partial<{ post: ApiLike['post']; put: PutMock }> = {}) {
    const calls: string[] = [];
    const client: ApiLike = {
      get: vi.fn(),
      post: vi.fn(async (endpoint: string) => {
        calls.push(`POST ${endpoint}`);
        return endpoint.endsWith('/complete') ? ready : created;
      }),
      delete: vi.fn(async (endpoint: string) => {
        calls.push(`DELETE ${endpoint}`);
      }),
    };
    if (over.post) client.post = vi.fn(over.post);
    const put: PutMock = over.put ?? vi.fn<[PutArgs], Promise<void>>(async () => undefined);
    return { client, put, calls };
  }

  it('runs request -> PUT -> complete in order and returns the ready attachment', async () => {
    const { client, put, calls } = setup();
    const f = file();
    put.mockImplementation(async () => {
      calls.push('PUT storage');
    });

    const result = await uploadAttachment({ projectId: P, taskId: T, file: f, client, put });

    expect(result).toEqual(ready);
    expect(calls).toEqual([`POST ${BASE}`, 'PUT storage', `POST ${BASE}/att-1/complete`]);
  });

  it('declares the filename, size and an extension-derived type (never File.type)', async () => {
    const { client, put } = setup();

    await uploadAttachment({ projectId: P, taskId: T, file: file('notes.md', 'hello', ''), client, put });

    expect(client.post).toHaveBeenNthCalledWith(1, BASE, {
      filename: 'notes.md',
      content_type: 'text/markdown', // the browser reports '' for .md
      size: 5,
    });
  });

  it('sends the bytes to the presigned URL with exactly the server-provided headers', async () => {
    const { client, put } = setup();
    const f = file();

    await uploadAttachment({ projectId: P, taskId: T, file: f, client, put });

    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ url: upload.url, method: 'PUT', headers: upload.headers, file: f })
    );
  });

  it('sends a body with the complete call (the API rejects a bodiless JSON POST)', async () => {
    const { client, put } = setup();

    await uploadAttachment({ projectId: P, taskId: T, file: file(), client, put });

    expect(client.post).toHaveBeenNthCalledWith(2, `${BASE}/att-1/complete`, {});
  });

  it('forwards progress and the abort signal to the upload', async () => {
    const { client, put } = setup();
    const onProgress = vi.fn();
    const controller = new AbortController();

    await uploadAttachment({ projectId: P, taskId: T, file: file(), client, put, onProgress, signal: controller.signal });

    expect(put).toHaveBeenCalledWith(expect.objectContaining({ onProgress, signal: controller.signal }));
  });

  describe('validation (no network at all)', () => {
    it.each([
      ['an unsupported type', file('run.exe')],
      ['a file with no extension', file('README')],
      ['an empty file', file('empty.txt', '')],
    ])('rejects %s before contacting the server', async (_label, f) => {
      const { client, put } = setup();

      const err = await uploadAttachment({ projectId: P, taskId: T, file: f, client, put }).catch((e) => e);

      expect(err).toBeInstanceOf(AttachmentError);
      expect(err.stage).toBe('validate');
      expect(client.post).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
    });

    it('names the file and lists what is allowed', async () => {
      const { client, put } = setup();
      const err = await uploadAttachment({ projectId: P, taskId: T, file: file('run.exe'), client, put }).catch((e) => e);

      expect(err.message).toContain('run.exe');
      expect(err.message).toContain('pdf');
    });
  });

  describe('failure handling', () => {
    it('surfaces the server message when the request is refused, and leaves nothing to clean up', async () => {
      const { client, put } = setup({
        post: async () => {
          throw new Error('File exceeds the maximum size of 10485760 bytes');
        },
      });

      const err = await uploadAttachment({ projectId: P, taskId: T, file: file(), client, put }).catch((e) => e);

      expect(err).toMatchObject({ stage: 'request', message: 'File exceeds the maximum size of 10485760 bytes' });
      expect(put).not.toHaveBeenCalled();
      expect(client.delete).not.toHaveBeenCalled(); // no pending row was created
    });

    it('deletes the pending row and skips complete when the storage upload fails', async () => {
      const { client, put } = setup({ put: vi.fn().mockRejectedValue(new Error('Storage rejected the upload (HTTP 403)')) });

      const err = await uploadAttachment({ projectId: P, taskId: T, file: file(), client, put }).catch((e) => e);

      expect(err).toMatchObject({ stage: 'upload', message: 'Storage rejected the upload (HTTP 403)', aborted: false });
      expect(client.delete).toHaveBeenCalledWith(`${BASE}/att-1`);
      expect(client.post).toHaveBeenCalledTimes(1); // never called complete
    });

    it('treats a cancelled upload as aborted (not an error to show) and cleans up', async () => {
      const abort = new DOMException('Upload cancelled', 'AbortError');
      const { client, put } = setup({ put: vi.fn().mockRejectedValue(abort) });

      const err = await uploadAttachment({ projectId: P, taskId: T, file: file(), client, put }).catch((e) => e);

      expect(err).toBeInstanceOf(AttachmentError);
      expect(err.aborted).toBe(true);
      expect(client.delete).toHaveBeenCalledWith(`${BASE}/att-1`);
    });

    it('deletes the pending row when verification fails', async () => {
      const { client, put } = setup({
        post: async (endpoint: string) => {
          if (endpoint.endsWith('/complete')) throw new Error('File contents do not match the declared type');
          return created;
        },
      });

      const err = await uploadAttachment({ projectId: P, taskId: T, file: file(), client, put }).catch((e) => e);

      expect(err).toMatchObject({ stage: 'complete', message: 'File contents do not match the declared type' });
      expect(client.delete).toHaveBeenCalledWith(`${BASE}/att-1`);
    });

    it('reports the original error even if the cleanup delete also fails', async () => {
      const { client, put } = setup({ put: vi.fn().mockRejectedValue(new Error('network down')) });
      client.delete = vi.fn().mockRejectedValue(new Error('also down'));

      const err = await uploadAttachment({ projectId: P, taskId: T, file: file(), client, put }).catch((e) => e);

      expect(err).toMatchObject({ stage: 'upload', message: 'network down' });
    });

    it('falls back to a generic message for non-Error rejections', async () => {
      const { client, put } = setup({ put: vi.fn().mockRejectedValue('weird') });

      const err = await uploadAttachment({ projectId: P, taskId: T, file: file(), client, put }).catch((e) => e);

      expect(err.message).toBe('Something went wrong');
    });
  });
});

describe('list / download / delete', () => {
  const client = (): ApiLike => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() });

  it('builds task-scoped paths', () => {
    expect(attachmentsPath(P, T)).toBe(BASE);
  });

  it('lists attachments for the task', async () => {
    const c = client();
    vi.mocked(c.get).mockResolvedValue([{ id: 'a' }]);

    expect(await listAttachments(P, T, c)).toEqual([{ id: 'a' }]);
    expect(c.get).toHaveBeenCalledWith(BASE);
  });

  it('returns only the URL from the download endpoint', async () => {
    const c = client();
    vi.mocked(c.get).mockResolvedValue({ url: 'https://storage.test/get?sig=2', expires_in: 120 });

    expect(await getDownloadUrl(P, T, 'att-1', c)).toBe('https://storage.test/get?sig=2');
    expect(c.get).toHaveBeenCalledWith(`${BASE}/att-1/download`);
  });

  it('deletes by id', async () => {
    const c = client();
    vi.mocked(c.delete).mockResolvedValue(null);

    await deleteAttachment(P, T, 'att-1', c);

    expect(c.delete).toHaveBeenCalledWith(`${BASE}/att-1`);
  });
});
