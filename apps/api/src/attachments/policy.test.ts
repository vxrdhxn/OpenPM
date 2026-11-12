import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TYPES,
  MAX_FILENAME_LENGTH,
  SNIFF_BYTES,
  buildStorageKey,
  contentDisposition,
  contentMatchesType,
  extensionOf,
  sanitizeFilename,
  validateUpload,
} from './policy';

const bytes = (...b: number[]) => Uint8Array.from(b);
const text = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'));
const MAX = 1000;

describe('sanitizeFilename', () => {
  it.each([
    ['report.pdf', 'report.pdf'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\secret.txt', 'secret.txt'],
    ['/abs/path/file.png', 'file.png'],
    ['a/b\\c/d.csv', 'd.csv'],
    ['  spaced   out  .txt', 'spaced out .txt'],
    ['.hidden', 'hidden'],
    ['name.with.dots.md', 'name.with.dots.md'],
    ['trailing. . ', 'trailing'],
    ['we<ir>d:"na|me?*.txt', 'we_ir_d__na_me__.txt'],
    ['', 'file'],
    ['....', 'file'],
    ['///', 'file'],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('removes control characters, including NUL and newlines', () => {
    expect(sanitizeFilename('a\u0000b\r\nc\u007fd.txt')).toBe('abcd.txt');
  });

  it('removes bidi overrides used to disguise extensions', () => {
    // Without the override stripped this renders as "invoiceexe.jpg".
    expect(sanitizeFilename('invoice\u202Egpj.exe')).toBe('invoicegpj.exe');
    expect(sanitizeFilename('x\u2066y\u2069.pdf')).toBe('xy.pdf');
  });

  it('normalizes unicode to NFC', () => {
    expect(sanitizeFilename('e\u0301.txt')).toBe('\u00e9.txt');
  });

  it('caps length at 255 while keeping the extension', () => {
    const out = sanitizeFilename('a'.repeat(400) + '.pdf');
    expect(out).toHaveLength(MAX_FILENAME_LENGTH);
    expect(out.endsWith('.pdf')).toBe(true);
  });
});

describe('extensionOf', () => {
  it.each([
    ['a.PNG', 'png'],
    ['a.tar.gz', 'gz'],
    ['noext', ''],
    ['.bashrc', ''],
    ['trailing.', ''],
  ])('%j -> %j', (input, expected) => {
    expect(extensionOf(input)).toBe(expected);
  });
});

describe('validateUpload', () => {
  const ok = (filename: string, contentType: string, size = 10) =>
    validateUpload({ filename, contentType, size }, MAX);

  it('accepts a valid upload and returns the sanitized name', () => {
    expect(ok('../Quarterly Report.PDF', 'application/pdf')).toEqual({ ok: true, filename: 'Quarterly Report.PDF' });
  });

  it('accepts every allowed type with each of its own extensions', () => {
    for (const [type, def] of Object.entries(ALLOWED_TYPES)) {
      for (const ext of def.extensions) {
        expect(ok(`file.${ext}`, type), `${type} .${ext}`).toMatchObject({ ok: true });
      }
    }
  });

  it.each([
    'text/html',
    'image/svg+xml',
    'application/javascript',
    'application/x-msdownload',
    'application/x-sh',
    'application/zip',
    'application/octet-stream',
    'text/plain; charset=utf-8',
    'IMAGE/PNG',
    '',
  ])('rejects content type %j', (type) => {
    expect(ok('file.txt', type)).toMatchObject({ ok: false });
  });

  it.each([
    ['payload.exe', 'application/pdf'],
    ['page.html', 'text/plain'],
    ['photo.png', 'image/jpeg'],
    ['noextension', 'image/png'],
    ['.png', 'image/png'], // sanitizes to "png": no extension remains
  ])('rejects extension/type mismatch: %s as %s', (name, type) => {
    expect(ok(name, type)).toMatchObject({ ok: false });
  });

  it('judges the extension after sanitizing, so a trailing-dot or bidi trick cannot smuggle one in', () => {
    expect(ok('evil.exe.', 'application/pdf')).toMatchObject({ ok: false }); // -> evil.exe
    expect(ok('doc.pdf\u202E', 'application/pdf')).toMatchObject({ ok: true }); // -> doc.pdf
  });

  it.each([0, -1, 1.5, NaN, Infinity, MAX + 1])('rejects size %s', (size) => {
    expect(ok('a.txt', 'text/plain', size)).toMatchObject({ ok: false });
  });

  it('allows a file exactly at the limit', () => {
    expect(ok('a.txt', 'text/plain', MAX)).toMatchObject({ ok: true });
  });

  it('never allows active-content or executable extensions through any allowed type', () => {
    const dangerous = ['html', 'htm', 'svg', 'js', 'mjs', 'exe', 'dll', 'sh', 'bat', 'cmd', 'php', 'jar', 'ps1'];
    for (const [type, def] of Object.entries(ALLOWED_TYPES)) {
      expect(def.extensions.filter((e) => dangerous.includes(e)), type).toEqual([]);
    }
  });
});

describe('contentMatchesType (magic bytes)', () => {
  const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
  const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
  const PDF = text('%PDF-1.7\n');
  const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0);
  const WEBP = Uint8Array.from([...text('RIFF'), 1, 2, 3, 4, ...text('WEBP')]);
  const OOXML = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ];

  it('accepts genuine signatures', () => {
    expect(contentMatchesType('image/png', PNG)).toBe(true);
    expect(contentMatchesType('image/jpeg', JPEG)).toBe(true);
    expect(contentMatchesType('image/gif', text('GIF89a....'))).toBe(true);
    expect(contentMatchesType('image/gif', text('GIF87a....'))).toBe(true);
    expect(contentMatchesType('image/webp', WEBP)).toBe(true);
    expect(contentMatchesType('application/pdf', PDF)).toBe(true);
    for (const t of OOXML) expect(contentMatchesType(t, ZIP)).toBe(true);
  });

  it('rejects a file whose bytes do not match its declared type', () => {
    expect(contentMatchesType('image/png', JPEG)).toBe(false);
    expect(contentMatchesType('application/pdf', PNG)).toBe(false);
    expect(contentMatchesType('image/webp', text('RIFF....WAVE'))).toBe(false);
    for (const t of OOXML) expect(contentMatchesType(t, PDF)).toBe(false);
  });

  it('rejects an executable or script renamed to an allowed type', () => {
    const windowsExe = text('MZ\x90\x00\x03');
    const elf = bytes(0x7f, 0x45, 0x4c, 0x46);
    for (const t of ['image/png', 'image/jpeg', 'application/pdf', ...OOXML]) {
      expect(contentMatchesType(t, windowsExe), t).toBe(false);
      expect(contentMatchesType(t, elf), t).toBe(false);
    }
  });

  it('accepts text types only when there are no NUL bytes', () => {
    expect(contentMatchesType('text/plain', text('hello world'))).toBe(true);
    expect(contentMatchesType('text/csv', text('a,b\n1,2'))).toBe(true);
    expect(contentMatchesType('text/plain', bytes(0x68, 0x00, 0x69))).toBe(false);
    expect(contentMatchesType('text/plain', bytes())).toBe(false);
  });

  it('rejects unknown types and empty input', () => {
    expect(contentMatchesType('image/svg+xml', text('<svg'))).toBe(false);
    expect(contentMatchesType('image/png', bytes())).toBe(false);
  });

  it('decides from the first SNIFF_BYTES bytes alone (that is all completion reads)', () => {
    const padding = new Uint8Array(1024).fill(0x41);
    const samples: Array<[string, Uint8Array]> = [
      ['image/png', PNG],
      ['image/jpeg', JPEG],
      ['image/gif', text('GIF89a')],
      ['image/webp', WEBP],
      ['application/pdf', PDF],
      [OOXML[0]!, ZIP],
    ];
    for (const [type, sample] of samples) {
      const full = Uint8Array.from([...sample, ...padding]);
      expect(contentMatchesType(type, full.slice(0, SNIFF_BYTES)), type).toBe(true);
      expect(contentMatchesType(type, full), type).toBe(true);
    }
  });
});

describe('buildStorageKey', () => {
  const ORG = '11111111-1111-1111-1111-111111111111';
  const TASK = '22222222-2222-2222-2222-222222222222';

  it('is scoped by org and task and ends in a random uuid', () => {
    const key = buildStorageKey(ORG, TASK);
    expect(key).toMatch(new RegExp(`^org/${ORG}/tasks/${TASK}/[0-9a-f-]{36}$`));
  });

  it('is unique per call', () => {
    expect(buildStorageKey(ORG, TASK)).not.toBe(buildStorageKey(ORG, TASK));
  });
});

describe('contentDisposition', () => {
  it('always forces a download', () => {
    expect(contentDisposition('a.pdf')).toMatch(/^attachment; /);
  });

  it('carries a plain ASCII name in both forms', () => {
    expect(contentDisposition('report.pdf')).toBe(`attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
  });

  it('uses an ASCII fallback and an RFC 5987 form for non-ASCII names', () => {
    const header = contentDisposition('résumé.pdf');
    expect(header).toContain('filename="r_sum_.pdf"');
    expect(header).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf");
  });

  it('cannot be used to inject header parameters or break out of the quotes', () => {
    // Exactly: a quoted ASCII fallback with no inner quote, backslash or control char, then an
    // RFC 5987 form containing only unreserved or percent-encoded characters.
    // eslint-disable-next-line no-control-regex
    const wellFormed = /^attachment; filename="[^"\\\x00-\x1f\x7f-￿]*"; filename\*=UTF-8''[A-Za-z0-9%._~-]*$/;
    for (const hostile of ['a"; filename="evil.exe', 'x\\"y.txt', 'a\r\nSet-Cookie: x=1.txt', 'q"; attachment; inline.txt']) {
      expect(contentDisposition(hostile), hostile).toMatch(wellFormed);
    }
    // The quote in the hostile name was neutralized rather than ending the quoted string early.
    expect(contentDisposition('a"; filename="evil.exe')).toContain('filename="a_; filename=_evil.exe"');
  });

  it('percent-encodes characters RFC 5987 reserves', () => {
    expect(contentDisposition("it's (1)*.txt")).toContain("filename*=UTF-8''it%27s%20%281%29%2A.txt");
  });
});
