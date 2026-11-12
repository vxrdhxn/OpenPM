/**
 * RealtimeHub: fan-out of Redis pub/sub messages to local subscribers.
 *
 * A Redis connection in subscriber mode can't run normal commands, and opening one
 * per WebSocket client doesn't scale. The hub owns ONE subscriber connection per pod
 * and reference-counts channels: SUBSCRIBE on the first local listener for a channel,
 * UNSUBSCRIBE when the last one leaves. Every pod subscribes independently, so an
 * event published by any pod reaches clients connected to all pods.
 */

/** The slice of an ioredis client the hub needs (kept minimal so it's easy to fake). */
export interface Subscriber {
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
}

/** `message` is the parsed JSON payload; `raw` is the original string (cheap to forward as-is). */
export type Handler = (message: any, raw: string) => void;

interface Logger {
  error: (...args: unknown[]) => void;
}

export class RealtimeHub {
  private readonly handlers = new Map<string, Set<Handler>>();
  /** In-flight SUBSCRIBE per channel, so concurrent first-listeners wait for the same command. */
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(
    private readonly sub: Subscriber,
    private readonly log: Logger = console
  ) {
    sub.on('message', (channel, raw) => this.dispatch(channel, raw));
  }

  /** Number of channels this pod is subscribed to. */
  get channelCount(): number {
    return this.handlers.size;
  }

  /** Number of listeners on a channel (all clients of an org on this pod). */
  listenerCount(channel: string): number {
    return this.handlers.get(channel)?.size ?? 0;
  }

  /**
   * Register `handler` for `channel`. Resolves once Redis has confirmed the subscription,
   * and returns an idempotent unsubscribe function.
   */
  async subscribe(channel: string, handler: Handler): Promise<() => void> {
    let set = this.handlers.get(channel);

    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      const attempt = this.sub.subscribe(channel).finally(() => {
        if (this.pending.get(channel) === attempt) this.pending.delete(channel);
      });
      this.pending.set(channel, attempt);
    }

    set.add(handler);

    try {
      await this.pending.get(channel);
    } catch (err) {
      // Redis refused the SUBSCRIBE: forget this attempt so a later call retries cleanly.
      set.delete(handler);
      if (set.size === 0 && this.handlers.get(channel) === set) this.handlers.delete(channel);
      throw err;
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;

      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);

      if (current.size === 0) {
        this.handlers.delete(channel);
        this.sub.unsubscribe(channel).catch((err) => this.log.error('Redis UNSUBSCRIBE failed', channel, err));
      }
    };
  }

  private dispatch(channel: string, raw: string): void {
    const set = this.handlers.get(channel);
    if (!set || set.size === 0) return;

    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch (err) {
      this.log.error('Dropping non-JSON message on', channel, err);
      return;
    }

    // Copy: a handler may unsubscribe itself while we iterate.
    for (const handler of [...set]) {
      try {
        handler(message, raw);
      } catch (err) {
        this.log.error('Realtime handler threw', channel, err);
      }
    }
  }
}
