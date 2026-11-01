import { useEffect, useState } from "react";

/**
 * A value that settles `delay` milliseconds after the last change.
 *
 * The first value is returned immediately; every later one waits, so a typed
 * query does not become one request per keystroke.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
