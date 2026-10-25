/**
 * The highlight accent: one preset per space, stored in `space.yml`.
 *
 * One accent marks state — focus, selection, the primary action, the active
 * rail and view tabs, the `DEFAULT` marker. The space owns it, so every member
 * sees the same highlight; `SpaceLayout` is the only applier, reading the
 * space detail and setting `data-accent` on the root. The browser-local key
 * from v0.4 is read once to seed an owner's shared value, then deleted.
 */
export type AccentId = "lichen" | "yellow" | "orange" | "cyan" | "green" | "pink";

export interface AccentScheme {
  /** Accent used for text, focus rings and the primary surface. */
  accent: string;
  /** Text and glyphs drawn on the accent surface. */
  ink: string;
}

export interface AccentPalette {
  id: AccentId;
  label: string;
  dark: AccentScheme;
  light: AccentScheme;
}

/** The single normative spelling; `globals.css` mirrors these values. */
export const ACCENTS: readonly AccentPalette[] = [
  {
    id: "lichen",
    label: "Lichen",
    dark: { accent: "#c8d96b", ink: "#14180f" },
    light: { accent: "#5f6f1e", ink: "#f7f8f0" },
  },
  {
    id: "yellow",
    label: "Yellow",
    dark: { accent: "#f2d64b", ink: "#1a1503" },
    light: { accent: "#6f5d00", ink: "#fbf9ea" },
  },
  {
    id: "orange",
    label: "Orange",
    dark: { accent: "#f5a24a", ink: "#1c1204" },
    light: { accent: "#9a4a00", ink: "#fdf6ee" },
  },
  {
    id: "cyan",
    label: "Cyan",
    dark: { accent: "#6fdbe8", ink: "#04181a" },
    light: { accent: "#00646e", ink: "#eefcfe" },
  },
  {
    id: "green",
    label: "Green",
    dark: { accent: "#7fe08a", ink: "#051706" },
    light: { accent: "#256b33", ink: "#f0fbf2" },
  },
  {
    id: "pink",
    label: "Pink",
    dark: { accent: "#f49ac1", ink: "#1d0711" },
    light: { accent: "#96325f", ink: "#fdf1f6" },
  },
];

export const DEFAULT_ACCENT: AccentId = "lichen";

/** The slice of `Storage` this module needs; a fake can stand in for it. */
export interface AccentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The v0.4 browser-local key; read once to seed a space, then deleted. */
export function storedAccentKey(userId: string, spaceId: string): string {
  return `thing:accent:${userId}:${spaceId}`;
}

export function isAccentId(value: unknown): value is AccentId {
  return ACCENTS.some((accent) => accent.id === value);
}

/**
 * The old local choice, or the default when it is absent, malformed or
 * unreadable. Used only for the one-time seed; a refused read never blocks a
 * space from loading.
 */
export function readStoredAccent(storage: AccentStorage, key: string): AccentId {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return DEFAULT_ACCENT;
  }
  return isAccentId(raw) ? raw : DEFAULT_ACCENT;
}

/** Removes the old local choice; a refusal is swallowed. */
export function clearStoredAccent(storage: AccentStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Private mode or quota: the key stays, and the next load retries.
  }
}

/** Applies an accent to the document root, where the CSS tokens read it. */
export function applyAccent(root: HTMLElement, id: AccentId): void {
  root.dataset.accent = id;
}

/** Drops back to the stylesheet's default accent outside a space. */
export function resetAccent(root: HTMLElement): void {
  delete root.dataset.accent;
}
