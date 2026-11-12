import { useEffect, useState } from 'react';

type WebSocketMessage = {
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
 * Authentication is the httpOnly `auth_token` cookie, which the browser attaches to the
 * handshake automatically; JavaScript never reads or sends the token (and it must not go in
 * the URL, where it would be logged). Reconnects with exponential backoff, since the socket
 * is dropped on every API pod restart and by idle load balancers.
 *
 * `connectionEpoch` increments on every successful (re)connect. Events published while the
 * socket was down are not replayed, so consumers should refetch when it goes above 1.
 */
export function useWebsocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [connectionEpoch, setConnectionEpoch] = useState(0);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000/ws';
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    const connect = () => {
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        attempt = 0;
        setIsConnected(true);
        setConnectionEpoch((n) => n + 1);
      };

      socket.onmessage = (event) => {
        try {
          setLastMessage(JSON.parse(event.data));
        } catch (e) {
          console.error('Error parsing WS message', e);
        }
      };

      socket.onclose = (event) => {
        setIsConnected(false);
        if (disposed || event.code === CLOSE_POLICY_VIOLATION) return;

        // Exponential backoff with jitter so clients don't reconnect in lockstep after a deploy.
        const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
        attempt += 1;
        retryTimer = setTimeout(connect, delay / 2 + Math.random() * (delay / 2));
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, []);

  return { isConnected, lastMessage, connectionEpoch };
}
