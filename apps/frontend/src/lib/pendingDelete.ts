/**
 * Undo after delete: the item disappears at once, but the delete is only sent after a grace period.
 * Undo within it cancels the delete and nothing ever reached the server. If the page is closed or
 * left during the grace period, every pending delete is sent right away (as a keepalive request, so
 * it survives the page going away): what the user saw deleted stays deleted.
 */

export interface PendingDelete {
  /** Cancel the delete if it has not been sent yet. True when it was cancelled (so the item can come back). */
  cancel(): boolean;
}

interface Entry {
  timer: ReturnType<typeof setTimeout>;
  send: (keepalive: boolean) => Promise<unknown>;
}

const pending = new Map<string, Entry>();
let listening = false;

/** Send everything still waiting, now. Called when the page is hidden or unloaded. */
export function flushPendingDeletes() {
  for (const [key, entry] of pending) {
    clearTimeout(entry.timer);
    pending.delete(key);
    entry.send(true).catch(() => undefined);
  }
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  // pagehide covers closing the tab, reloading and leaving the site (also from the back/forward cache).
  window.addEventListener('pagehide', flushPendingDeletes);
}

/**
 * Delete later. `send` performs the delete (with `keepalive` when the page is going away); `onError`
 * hears if it fails, so the item can be put back. A second schedule for the same key replaces nothing:
 * the first one stays in charge.
 */
export function scheduleDelete(
  key: string,
  send: (keepalive: boolean) => Promise<unknown>,
  { delayMs = 6500, onSent, onError }: { delayMs?: number; onSent?: () => void; onError?: (err: unknown) => void } = {},
): PendingDelete {
  listen();
  if (!pending.has(key)) {
    const timer = setTimeout(() => {
      pending.delete(key);
      send(false).then(() => onSent?.(), (err) => onError?.(err));
    }, delayMs);
    pending.set(key, { timer, send });
  }
  return {
    cancel() {
      const entry = pending.get(key);
      if (!entry) return false;
      clearTimeout(entry.timer);
      pending.delete(key);
      return true;
    },
  };
}

/** Whether a delete for this key is waiting (a reload must not bring the item back meanwhile). */
export const isPendingDelete = (key: string) => pending.has(key);

/** How many deletes are waiting (for tests and for warning before navigation). */
export const pendingDeleteCount = () => pending.size;
