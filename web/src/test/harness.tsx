import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, vi } from "vitest";

import { ToastProvider } from "@/components/ui/toast";

/** A JSON `Response`, the shape every API route returns on success. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Response | Promise<Response>;

/**
 * Replace the global fetch for one test. The URL is what a handler switches on;
 * a route the test did not describe throws instead of resolving to an empty
 * body, so a missing stub reads as a failure rather than a silent zero.
 */
export function stubFetch(handler: FetchHandler) {
  const mock = vi.fn(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** The URL a request was made against, whether fetch got a string or a Request. */
export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

/** A fresh client per render: no cache carried between tests, no retries. */
export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface ProviderOptions extends Omit<RenderOptions, "wrapper"> {
  /** The URL the router starts at. */
  route?: string;
  queryClient?: QueryClient;
}

export interface HarnessRender extends RenderResult {
  queryClient: QueryClient;
}

/**
 * Render the real component inside the providers it expects in the app: a
 * query client, the toast provider and a memory router. Production code is not
 * aware this exists.
 */
export function renderWithProviders(
  ui: ReactElement,
  { route = "/", queryClient = testQueryClient(), ...options }: ProviderOptions = {},
): HarnessRender {
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );
  }

  return { queryClient, ...render(ui, { wrapper: Providers, ...options }) };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
