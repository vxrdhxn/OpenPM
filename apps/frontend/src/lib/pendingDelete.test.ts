import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPendingDeletes, pendingDeleteCount, scheduleDelete } from './pendingDelete';

describe('scheduleDelete', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    flushPendingDeletes();
    vi.useRealTimers();
  });

  it('sends the delete only after the grace period', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const onSent = vi.fn();
    scheduleDelete('t1', send, { delayMs: 5000, onSent });

    vi.advanceTimersByTime(4999);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledWith(false);
    await vi.runAllTimersAsync();
    expect(onSent).toHaveBeenCalled();
    expect(pendingDeleteCount()).toBe(0);
  });

  it('undo within the grace period cancels it: nothing is sent', () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const pending = scheduleDelete('t2', send, { delayMs: 5000 });

    expect(pending.cancel()).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(send).not.toHaveBeenCalled();
    // Too late to undo twice.
    expect(pending.cancel()).toBe(false);
  });

  it('undo after it was sent says so, so the item is not put back', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const pending = scheduleDelete('t3', send, { delayMs: 1000 });
    vi.advanceTimersByTime(1000);
    expect(pending.cancel()).toBe(false);
  });

  it('reports a failed delete, so the item can come back', async () => {
    const err = new Error('nope');
    const onError = vi.fn();
    scheduleDelete('t4', vi.fn().mockRejectedValue(err), { delayMs: 10, onError });
    await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('leaving the page sends every pending delete at once, as keepalive requests', () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    scheduleDelete('t5', a, { delayMs: 5000 });
    scheduleDelete('t6', b, { delayMs: 5000 });

    flushPendingDeletes();
    expect(a).toHaveBeenCalledWith(true);
    expect(b).toHaveBeenCalledWith(true);
    expect(pendingDeleteCount()).toBe(0);
    // And not a second time when the timers would have fired.
    vi.advanceTimersByTime(5000);
    expect(a).toHaveBeenCalledTimes(1);
  });
});
