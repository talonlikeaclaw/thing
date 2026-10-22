/**
 * The zones a space may name. The server resolves the same IANA names through
 * jiff; this list only keeps the picker honest about what the runtime knows.
 */
function supportedTimezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

const SUPPORTED = supportedTimezones();

/**
 * Sorted zone names, always including `current`.
 *
 * A space may already name a zone this runtime omits (an older browser, a
 * renamed alias), and opening settings must not silently change it.
 */
export function timezoneNames(current?: string): string[] {
  const names = new Set(SUPPORTED);
  // `supportedValuesOf` lists canonical zones only; UTC is the server fallback
  // and must stay reachable after a space moves away from it.
  names.add("UTC");
  if (current) {
    names.add(current);
  }
  return [...names].sort();
}

/**
 * The zone a new space starts with: the browser's own when the picker knows it,
 * otherwise UTC. The server applies the same fallback for a missing zone.
 */
export function defaultSpaceTimezone(): string {
  const named = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return named && SUPPORTED.includes(named) ? named : "UTC";
}
