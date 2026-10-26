import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { RouterProvider } from "react-router/dom";

import { useSheetViewport } from "@/components/ui/sheet";
import { ToastProvider } from "@/components/ui/toast";
import { router } from "@/router";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  // The visual-viewport subscription belongs to every route, signed in or not:
  // it only writes CSS variables, so it costs nothing until a sheet reads them.
  useSheetViewport();

  return (
    <StrictMode>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}
