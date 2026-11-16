'use client';

import { useWebsocketConnection, WebsocketContext } from './useWebsocket';

/** Opens the app's one WebSocket and shares it with everything below (see useWebsocket). */
export default function WebsocketProvider({ children }: { children: React.ReactNode }) {
  const state = useWebsocketConnection();
  return <WebsocketContext.Provider value={state}>{children}</WebsocketContext.Provider>;
}
