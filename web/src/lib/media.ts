import { useSyncExternalStore } from "react";

/**
 * Two media questions the UI asks, resolved in one place so no component
 * re-implements the `matchMedia` plumbing.
 *
 * `COMPACT_QUERY` is width only: it is the phone layout, and a desktop window
 * dragged narrow gets it too. `COARSE_QUERY` is the input device: a phone or a
 * tablet with a finger, at any width. A surface that must be reachable by touch
 * but has no room as a popover asks for either.
 */
export const COMPACT_QUERY = "(max-width: 639px)";
/** The desktop shell: the rail replaces the phone bar at this width. */
export const WIDE_QUERY = "(min-width: 64rem)";
export const COARSE_QUERY = "(pointer: coarse)";

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  };
}

function readMedia(query: string) {
  return () => window.matchMedia(query).matches;
}

/**
 * The synchronous answer for a one-off decision, e.g. whether a tap opens a
 * day panel or follows a link. The reactive form is `useCoarsePointer`.
 */
export function isCoarsePointer(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(COARSE_QUERY).matches
    : false;
}

// One listener set per question: the subscribe function keeps its identity
// across renders, so a component re-render does not resubscribe.
const subscribeWide = subscribeMedia(WIDE_QUERY);
const readWide = readMedia(WIDE_QUERY);
const subscribeCompact = subscribeMedia(COMPACT_QUERY);
const readCompact = readMedia(COMPACT_QUERY);
const subscribeCoarse = subscribeMedia(COARSE_QUERY);
const readCoarse = readMedia(COARSE_QUERY);

/** The desktop shell, where the record carries Save in its identity band. */
export function useWideLayout(): boolean {
  return useSyncExternalStore(subscribeWide, readWide, () => false);
}

/** Width-only compaction, as the type page already uses. */
export function useCompactWidth(): boolean {
  return useSyncExternalStore(subscribeCompact, readCompact, () => false);
}

/** A touch-first device: no fine pointer, e.g. a phone or a tablet. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribeCoarse, readCoarse, () => false);
}
