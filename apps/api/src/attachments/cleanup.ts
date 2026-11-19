import { withTransaction } from '../db/transaction';
import * as storageDeletions from '../data/storageDeletions';
import { abandonedUploadsReapedTotal, setStorageDeletionsOwedSource, storageDeletionsTotal } from '../metrics';
import { getStorage, type ObjectStorage } from '../storage';

interface Logger {
  error: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  info?: (obj: object, msg: string) => void;
}

/**
 * Attachment files outside the database (docs/attachments.md).
 *
 * Whenever attachment rows are deleted, the same transaction records their keys as owed
 * (`storageDeletions.owe`). After the commit, `deleteStoredObjects` deletes the objects and settles
 * the keys. Whatever is still owed (storage was down, the pod died between commit and delete) is
 * retried by the sweep, which also removes uploads that were started and never completed. A
 * rollback never loses a file that is still referenced, and no file is forgotten.
 */

// The storage_deletions_owed gauge (metrics.ts) reads the table at scrape time.
setStorageDeletionsOwedSource(storageDeletions.countOwed);

/** Uploads still pending this long after they were started are abandoned (the upload URL lives 5 min). */
export const ABANDONED_UPLOAD_MINUTES = 60;
const SWEEP_BATCH = 100;

/** Delete each object; returns the keys that are gone. Never throws. */
async function deleteEach(storage: ObjectStorage, keys: string[], log: Logger): Promise<{ done: string[]; failed: string[] }> {
  const done: string[] = [];
  const failed: string[] = [];
  await Promise.all(
    keys.map(async (key) => {
      try {
        await storage.delete(key);
        done.push(key);
        storageDeletionsTotal.inc({ result: 'deleted' });
      } catch (err) {
        failed.push(key);
        storageDeletionsTotal.inc({ result: 'failed' });
        log.warn({ err, key }, 'Could not delete an attachment object; the storage sweep will retry');
      }
    })
  );
  return { done, failed };
}

/**
 * Delete attachment objects after the transaction that removed their rows (and owed their keys) has
 * committed. Best effort: a storage problem never fails the user's delete; what is left stays owed.
 */
export async function deleteStoredObjects(keys: string[], log: Logger): Promise<void> {
  if (keys.length === 0) return;

  const storage = getStorage();
  if (!storage) {
    log.error({ count: keys.length }, 'Attachment rows deleted but storage is not configured; the deletions stay owed');
    return;
  }

  const { done } = await deleteEach(storage, keys, log);
  try {
    await storageDeletions.settle(done);
  } catch (err) {
    // The objects are gone; the sweep will delete them again (a no-op) and settle the keys.
    log.warn({ err }, 'Could not settle deleted storage keys; the storage sweep will');
  }
}

/** One sweep: reap abandoned uploads, then retry owed deletions that are due. Returns what it did. */
export async function sweepStorage(log: Logger): Promise<{ abandoned: number; deleted: number; failed: number }> {
  const storage = getStorage();
  if (!storage) return { abandoned: 0, deleted: 0, failed: 0 };

  const abandoned = await withTransaction((client) => storageDeletions.reapAbandonedUploads(client, ABANDONED_UPLOAD_MINUTES, SWEEP_BATCH));
  abandonedUploadsReapedTotal.inc(abandoned.length);

  // The keys stay locked while their objects are deleted, so no other pod retries the same ones.
  const result = await withTransaction(async (client) => {
    const due = await storageDeletions.claimDue(client, SWEEP_BATCH);
    const { done, failed } = await deleteEach(storage, due, log);
    await storageDeletions.settleIn(client, done);
    await storageDeletions.postpone(client, failed);
    return { deleted: done.length, failed: failed.length };
  });
  return { abandoned: abandoned.length, ...result };
}

/**
 * Sweep soon after start, then every `everyMs` (15 min). Every API pod runs it, like the audit-log
 * pruning; SKIP LOCKED keeps pods off each other's keys. Returns a stop function.
 */
export function startStorageSweep(log: Logger, everyMs = 15 * 60 * 1000): () => void {
  const run = () =>
    sweepStorage(log).then(
      (r) => {
        if (r.abandoned + r.deleted + r.failed > 0) log.info?.(r, 'Storage sweep');
      },
      (err) => log.warn({ err }, 'Storage sweep failed; will retry')
    );
  const first = setTimeout(run, 60_000 + Math.floor(Math.random() * 60_000));
  const every = setInterval(run, everyMs);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
