import { createContext, useContext, useEffect, useState } from 'react';
import { apiBaseUrl, websocketUrl } from '@/lib/endpoints';

export type WebSocketMessage = {
  type: string;
  [key: string]: any;
};

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
// The server closes with 1008 (policy violation) for auth, origin or expired-session
// failures. Retrying can't fix those, so we stop and let the normal 401 flow take over.
const CLOSE_POLICY_VIOLATION = 1008;

/**
 * Live updates for the signed-in user's organization.
 *
 * Authentication: before each connect, a single-use 30-second ticket is fetched from the API with the
 * httpOnly cookie and put in the socket URL (docs/realtime.md). This works when the socket goes to
 * another domain than the page (frontend on Vercel, API elsewhere), where the cookie is not sent.
 * JavaScript never reads the session token itself. Reconnects with exponential backoff, since the
 * socket is dropped on every API pod restart and by idle load balancers.
 *
 * `connectionEpoch` increments on every successful (re)connect. Events published while the
 * socket was down are not replayed, so consumers should refetch when it goes above 1.
 */
export function useWebsocketConnection(): WebsocketState {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [connectionEpoch, setConnectionEpoch] = useState(0);

  useEffect(() => {
    const wsUrl = websocketUrl();
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    const retry = () => {
      // Exponential backoff with jitter so clients don't reconnect in lockstep after a deploy.
      const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
      attempt += 1;
      retryTimer = setTimeout(connect, delay / 2 + Math.random() * (delay / 2));
    };

    const connect = async () => {
      let ticket: string;
      try {
        const res = await fetch(`${apiBaseUrl()}/realtime/ticket`, { method: 'POST', credentials: 'include' });
        // Signed out: retrying can't fix it, the normal 401 flow takes over (as with a 1008 close).
        if (res.status === 401) return;
        if (!res.ok) throw new Error(`ticket: HTTP ${res.status}`);
        ({ ticket } = await res.json());
      } catch {
        if (!disposed) retry();
        return;
      }
      if (disposed) return;

      socket = new WebSocket(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`);

      socket.onopen = () => {
        attempt = 0;
        setIsConnected(true);
        setConnectionEpoch((n) => n + 1);
      };

      socket.onmessage = (event) => {
        try {
          // Every event the API sends is an object with a string `type`; anything else is dropped.
          const data: unknown = JSON.parse(event.data);
          if (data && typeof data === 'object' && typeof (data as { type?: unknown }).type === 'string') {
            setLastMessage(data as WebSocketMessage);
          }
        } catch (e) {
          console.error('Error parsing WS message', e);
        }
      };

      socket.onclose = (event) => {
        setIsConnected(false);
        if (disposed || event.code === CLOSE_POLICY_VIOLATION) return;
        retry();
      };
    };

    void connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, []);

  return { isConnected, lastMessage, connectionEpoch };
}

export interface WebsocketState {
  isConnected: boolean;
  lastMessage: WebSocketMessage | null;
  connectionEpoch: number;
}

/** The app's one socket, provided by the signed-in layout (WebsocketProvider). */
export const WebsocketContext = createContext<WebsocketState>({ isConnected: false, lastMessage: null, connectionEpoch: 0 });

/**
 * Live updates for the signed-in user's organization, from the single socket the layout keeps open
 * (so the sidebar's notification badge and a board share one connection instead of opening two).
 */
export function useWebsocket(): WebsocketState {
  return useContext(WebsocketContext);
}
