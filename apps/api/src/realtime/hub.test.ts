import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeHub, Subscriber } from './hub';

class FakeSubscriber implements Subscriber {
  commands: string[] = [];
  private listener: ((channel: string, message: string) => void) | null = null;
  subscribeGate: Promise<void> | null = null;
  failNextSubscribe = false;

  async subscribe(channel: string) {
    this.commands.push(`SUBSCRIBE ${channel}`);
    if (this.subscribeGate) await this.subscribeGate;
    if (this.failNextSubscribe) {
      this.failNextSubscribe = false;
      throw new Error('redis down');
    }
  }

  async unsubscribe(channel: string) {
    this.commands.push(`UNSUBSCRIBE ${channel}`);
  }

  on(_event: 'message', listener: (channel: string, message: string) => void) {
    this.listener = listener;
  }

  /** Simulate Redis delivering a message. */
  emit(channel: string, message: string) {
    this.listener!(channel, message);
  }
}

const quietLog = { error: vi.fn() };

describe('RealtimeHub', () => {
  let sub: FakeSubscriber;
  let hub: RealtimeHub;

  beforeEach(() => {
    quietLog.error.mockReset();
    sub = new FakeSubscriber();
    hub = new RealtimeHub(sub, quietLog);
  });

  it('uses a single SUBSCRIBE per channel no matter how many local listeners', async () => {
    await Promise.all([
      hub.subscribe('org:1:updates', vi.fn()),
      hub.subscribe('org:1:updates', vi.fn()),
      hub.subscribe('org:1:updates', vi.fn()),
    ]);

    expect(sub.commands).toEqual(['SUBSCRIBE org:1:updates']);
    expect(hub.listenerCount('org:1:updates')).toBe(3);
  });

  it('waits for Redis to confirm before resolving, even for later listeners', async () => {
    let release!: () => void;
    sub.subscribeGate = new Promise<void>((r) => (release = r));
    let resolved = 0;

    const first = hub.subscribe('c', vi.fn()).then(() => resolved++);
    const second = hub.subscribe('c', vi.fn()).then(() => resolved++);
    await Promise.resolve();
    expect(resolved).toBe(0);

    release();
    await Promise.all([first, second]);
    expect(resolved).toBe(2);
    expect(sub.commands).toEqual(['SUBSCRIBE c']);
  });

  it('parses JSON once and delivers it to every listener of that channel only', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const other = vi.fn();
    await hub.subscribe('org:1:updates', a);
    await hub.subscribe('org:1:updates', b);
    await hub.subscribe('org:2:updates', other);

    sub.emit('org:1:updates', '{"type":"task_created","n":1}');

    expect(a).toHaveBeenCalledWith({ type: 'task_created', n: 1 }, '{"type":"task_created","n":1}');
    expect(b).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled(); // tenant isolation: other org never sees it
  });

  it('only UNSUBSCRIBEs when the last listener leaves', async () => {
    const offA = await hub.subscribe('c', vi.fn());
    const offB = await hub.subscribe('c', vi.fn());

    offA();
    expect(sub.commands).toEqual(['SUBSCRIBE c']);
    expect(hub.channelCount).toBe(1);

    offB();
    expect(sub.commands).toEqual(['SUBSCRIBE c', 'UNSUBSCRIBE c']);
    expect(hub.channelCount).toBe(0);
  });

  it('makes the unsubscribe function idempotent', async () => {
    const off = await hub.subscribe('c', vi.fn());
    const keep = vi.fn();
    await hub.subscribe('c', keep);

    off();
    off();
    off();

    expect(hub.listenerCount('c')).toBe(1);
    sub.emit('c', '{}');
    expect(keep).toHaveBeenCalledTimes(1);
  });

  it('stops delivering to a listener after it unsubscribes', async () => {
    const gone = vi.fn();
    const off = await hub.subscribe('c', gone);
    await hub.subscribe('c', vi.fn());

    off();
    sub.emit('c', '{}');

    expect(gone).not.toHaveBeenCalled();
  });

  it('resubscribes cleanly after the channel was fully released', async () => {
    const off = await hub.subscribe('c', vi.fn());
    off();
    await hub.subscribe('c', vi.fn());

    expect(sub.commands).toEqual(['SUBSCRIBE c', 'UNSUBSCRIBE c', 'SUBSCRIBE c']);
  });

  it('isolates a throwing listener from the others', async () => {
    const bad = vi.fn(() => {
      throw new Error('handler bug');
    });
    const good = vi.fn();
    await hub.subscribe('c', bad);
    await hub.subscribe('c', good);

    sub.emit('c', '{"x":1}');

    expect(good).toHaveBeenCalledTimes(1);
    expect(quietLog.error).toHaveBeenCalled();
  });

  it('drops non-JSON payloads without throwing or calling listeners', async () => {
    const handler = vi.fn();
    await hub.subscribe('c', handler);

    expect(() => sub.emit('c', 'not json')).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
    expect(quietLog.error).toHaveBeenCalled();
  });

  it('lets a listener unsubscribe itself while a message is being delivered', async () => {
    const calls: string[] = [];
    let offFirst: () => void = () => undefined;
    offFirst = await hub.subscribe('c', () => {
      calls.push('first');
      offFirst();
    });
    await hub.subscribe('c', () => calls.push('second'));

    sub.emit('c', '{}');
    sub.emit('c', '{}');

    expect(calls).toEqual(['first', 'second', 'second']);
  });

  it('ignores messages for channels nobody listens to', () => {
    expect(() => sub.emit('nobody', '{}')).not.toThrow();
  });

  describe('when Redis rejects the SUBSCRIBE', () => {
    it('rejects every waiting listener and leaves no stale state', async () => {
      sub.failNextSubscribe = true;

      const results = await Promise.allSettled([
        hub.subscribe('c', vi.fn()),
        hub.subscribe('c', vi.fn()),
      ]);

      expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
      expect(hub.channelCount).toBe(0);
      expect(hub.listenerCount('c')).toBe(0);
    });

    it('recovers on the next attempt', async () => {
      sub.failNextSubscribe = true;
      await expect(hub.subscribe('c', vi.fn())).rejects.toThrow('redis down');

      const handler = vi.fn();
      await hub.subscribe('c', handler);
      sub.emit('c', '{"ok":true}');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(sub.commands.filter((c) => c === 'SUBSCRIBE c')).toHaveLength(2);
    });
  });

  it('logs but does not throw when UNSUBSCRIBE fails', async () => {
    sub.unsubscribe = vi.fn().mockRejectedValue(new Error('gone'));
    const off = await hub.subscribe('c', vi.fn());

    expect(() => off()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(quietLog.error).toHaveBeenCalled();
  });
});
