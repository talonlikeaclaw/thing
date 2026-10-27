import { createContext, use, type ReactNode } from "react";

import type { ConnectionState } from "@/lib/use-space-events";

/**
 * The socket's state, already subscribed once by the shell. Reading it here
 * costs nothing; a second subscription would open a second socket.
 */
const ConnectionContext = createContext<ConnectionState>("live");

export function ConnectionProvider({
  state,
  children,
}: {
  state: ConnectionState;
  children: ReactNode;
}) {
  return <ConnectionContext value={state}>{children}</ConnectionContext>;
}

/** No provider means no space, hence no socket to report. */
export function useConnection(): ConnectionState {
  return use(ConnectionContext);
}
