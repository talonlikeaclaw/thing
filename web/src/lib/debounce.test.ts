import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDebouncedValue } from "@/lib/debounce";

describe("useDebouncedValue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the first value immediately and settles the last one after the delay", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 150),
      { initialProps: { value: "a" } },
    );
    expect(result.current).toBe("a");

    rerender({ value: "ab" });
    rerender({ value: "abc" });
    expect(result.current).toBe("a");

    act(() => vi.advanceTimersByTime(149));
    expect(result.current).toBe("a");

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("abc");
  });
});
