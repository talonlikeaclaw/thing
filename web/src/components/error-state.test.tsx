import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import { ErrorState, InlineError } from "@/components/error-state";
import { renderWithProviders } from "@/test/harness";

const offline = new ApiError(
  0,
  "network",
  "Could not reach the server. Check the connection and retry.",
);

describe("failure surfaces", () => {
  it("prints the server's sentence in a band and retries it", () => {
    const retry = vi.fn();
    render(<InlineError error={offline} onRetry={retry} />);

    expect(screen.getByRole("alert")).toHaveTextContent(offline.message);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("offers no retry when the band has nothing to retry", () => {
    render(<InlineError error={offline} />);

    expect(screen.getByRole("alert")).toHaveTextContent(offline.message);
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("keeps a failed page readable and retryable", () => {
    const retry = vi.fn();
    renderWithProviders(<ErrorState error={offline} subject="Schema" onRetry={retry} />);

    expect(screen.getByRole("heading")).toHaveTextContent("Could not load right now");
    expect(screen.getByText(offline.message)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
