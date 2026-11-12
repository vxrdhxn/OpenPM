import crypto from 'crypto';

/**
 * Attachment policy: what may be uploaded and how names/keys/headers are derived.
 * Pure functions only, so the rules are easy to test and review in one place.
 *
 * Threat model highlights:
 * - The client asserts the content type and filename; neither is trusted. The type must be on an
 *   allowlist, the extension must match it, and (on completion) the file's leading bytes must too.
 * - Files are only ever served as downloads (`Content-Disposition: attachment`), never rendered by
 *   the browser, and active-content types (HTML, SVG, scripts, executables) are not allowed at all.
 * - Storage keys are random and never contain user input, so there is nothing to traverse or guess.
 */

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((b, i) => bytes[offset + i] === b);

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Plain-text types have no signature; require that it at least isn't binary (no NUL bytes). */
const looksLikeText = (bytes: Uint8Array) => bytes.length > 0 && !bytes.includes(0);

const isZip = (bytes: Uint8Array) => startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]); // OOXML = zip container

interface AllowedType {
  extensions: string[];
  /** True if the file's leading bytes are plausible for this type. */
  matchesContent: (head: Uint8Array) => boolean;
}

export const ALLOWED_TYPES: Record<string, AllowedType> = {
  'image/png': {
    extensions: ['png'],
    matchesContent: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  'image/jpeg': {
    extensions: ['jpg', 'jpeg'],
    matchesContent: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  },
  'image/gif': {
    extensions: ['gif'],
    matchesContent: (b) => startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a')),
  },
  'image/webp': {
    extensions: ['webp'],
    matchesContent: (b) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8),
  },
  'application/pdf': {
    extensions: ['pdf'],
    matchesContent: (b) => startsWith(b, ascii('%PDF-')),
  },
  'text/plain': { extensions: ['txt', 'log'], matchesContent: looksLikeText },
  'text/csv': { extensions: ['csv'], matchesContent: looksLikeText },
  'text/markdown': { extensions: ['md'], matchesContent: looksLikeText },
  'application/json': { extensions: ['json'], matchesContent: looksLikeText },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extensions: ['docx'],
    matchesContent: isZip,
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    extensions: ['xlsx'],
    matchesContent: isZip,
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    extensions: ['pptx'],
    matchesContent: isZip,
  },
};

/** How many leading bytes `matchesContent` may inspect. */
export const SNIFF_BYTES = 16;

export const MAX_FILENAME_LENGTH = 255;
export const MAX_ATTACHMENTS_PER_TASK = 25;

// C0/C1 control chars, DEL, and Unicode bidi overrides/isolates (used to disguise extensions,
// e.g. "invoice\u202Egpj.exe" renders as "invoiceexe.jpg").
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const RESERVED_CHARS = /[<>:"|?*]/g;

/**
 * Normalize a client-supplied filename for display and for the download header.
 * Strips any directory part, control and bidi characters, and characters that are special on
 * common filesystems; falls back to "file" if nothing usable remains; caps the length while
 * preserving the extension.
 */
export function sanitizeFilename(input: string): string {
  let name = input.normalize('NFC');
  name = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1); // basename
  name = name.replace(UNSAFE_CHARS, '').replace(RESERVED_CHARS, '_').replace(/\s+/g, ' ');
  name = name.replace(/^[\s.]+|[\s.]+$/g, ''); // no leading dots (hidden files) / trailing dots+spaces

  if (!name) return 'file';

  if (name.length > MAX_FILENAME_LENGTH) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : '';
    name = name.slice(0, MAX_FILENAME_LENGTH - ext.length) + ext;
  }
  return name;
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

export interface UploadRequest {
  filename: string;
  contentType: string;
  size: number;
}

export type Validation = { ok: true; filename: string } | { ok: false; error: string };

export function validateUpload(req: UploadRequest, maxBytes: number): Validation {
  const type = ALLOWED_TYPES[req.contentType];
  if (!type) {
    return { ok: false, error: `Content type "${req.contentType}" is not allowed` };
  }

  if (!Number.isSafeInteger(req.size) || req.size <= 0) {
    return { ok: false, error: 'File size must be a positive integer' };
  }
  if (req.size > maxBytes) {
    return { ok: false, error: `File exceeds the maximum size of ${maxBytes} bytes` };
  }

  const filename = sanitizeFilename(req.filename);
  const ext = extensionOf(filename);
  if (!type.extensions.includes(ext)) {
    return {
      ok: false,
      error: `File extension ".${ext}" does not match content type ${req.contentType} (expected: ${type.extensions
        .map((e) => '.' + e)
        .join(', ')})`,
    };
  }

  return { ok: true, filename };
}

/** True if the file's leading bytes are plausible for its declared type. */
export function contentMatchesType(contentType: string, head: Uint8Array): boolean {
  return ALLOWED_TYPES[contentType]?.matchesContent(head) ?? false;
}

/** Random object key. Contains only server-generated ids; never any user-supplied text. */
export function buildStorageKey(orgId: string, taskId: string): string {
  return `org/${orgId}/tasks/${taskId}/${crypto.randomUUID()}`;
}

/**
 * `Content-Disposition` value that forces a download (never inline rendering) and carries the
 * filename safely: an ASCII fallback plus an RFC 5987 UTF-8 form.
 */
export function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
