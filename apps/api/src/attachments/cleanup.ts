import { getStorage } from '../storage';

interface Logger {
  error: (obj: object, msg: string) => void;
}

/**
 * Delete attachment objects from storage after their database rows are gone.
 *
 * Best-effort by design: call it AFTER the transaction that removed the rows has committed
 * (so a rollback never loses files that are still referenced), and never let a storage problem
 * fail the user's delete. A failed object delete leaves an unreferenced file, which is logged
 * so it can be cleaned up; the one-by-one handling means one failure doesn't strand the rest.
 */
export async function deleteStoredObjects(keys: string[], log: Logger): Promise<void> {
  if (keys.length === 0) return;

  const storage = getStorage();
  if (!storage) {
    log.error({ count: keys.length }, 'Attachment rows deleted but storage is not configured; objects orphaned');
    return;
  }

  await Promise.all(
    keys.map(async (key) => {
      try {
        await storage.delete(key);
      } catch (err) {
        log.error({ err, key }, 'Failed to delete attachment object (orphaned)');
      }
    })
  );
}
