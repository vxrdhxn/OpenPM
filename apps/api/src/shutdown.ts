interface Closable {
  close(): Promise<unknown>;
}

interface Log {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface ShutdownOptions {
  /** The Fastify app: closing it stops accepting connections and waits for in-flight requests. */
  app: Closable;
  /** Connections to close once no request can use them any more, by name (for the logs). */
  resources: Record<string, () => Promise<void>>;
  log: Log;
  exit: (code: number) => void;
  /**
   * Exit anyway after this long. Kubernetes kills the pod 30s after SIGTERM by default
   * (terminationGracePeriodSeconds), so finish a little before that and exit on our own terms.
   */
  timeoutMs?: number;
}

/**
 * Returns the SIGTERM/SIGINT handler. Order matters: stop HTTP first (in-flight requests may still
 * need the database, Redis and the queue), then close those. A failure to close one resource is
 * logged and does not stop the others from closing. A second signal while shutting down is ignored.
 */
export function createShutdown({ app, resources, log, exit, timeoutMs = 25_000 }: ShutdownOptions) {
  let shuttingDown = false;

  return async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'Shutting down gracefully');

    const timer = setTimeout(() => {
      log.error({ timeout_ms: timeoutMs }, 'Graceful shutdown timed out; exiting');
      exit(1);
    }, timeoutMs);
    timer.unref?.();

    let code = 0;
    try {
      await app.close();
    } catch (err) {
      code = 1;
      log.error({ err }, 'Error while closing the HTTP server');
    }

    const results = await Promise.allSettled(Object.values(resources).map((close) => close()));
    Object.keys(resources).forEach((name, i) => {
      const result = results[i]!;
      if (result.status === 'rejected') {
        code = 1;
        log.error({ err: result.reason, resource: name }, 'Error while closing a connection');
      }
    });

    clearTimeout(timer);
    log.info({ exit_code: code }, 'Shutdown complete');
    exit(code);
  };
}
