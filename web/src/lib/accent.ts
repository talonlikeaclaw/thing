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
  /**
   * Accent used as text on the wash. In light it is the accent darkened 10%
   * so it clears 4.5:1 over the wash on every scheme surface; in dark the
   * accent itself already clears it. `accent.test.ts` measures this pairing.
   */
  onWash: string;
  /**
   * The one tint, at `WASH_ALPHA` alpha, for selection, the active row, the
   * search match and drag. It is never a decorative panel and never sits
   * behind primary text; `accent.test.ts` measures body ink on it.
   */
  wash: string;
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
    dark: { accent: "#c8d96b", ink: "#14180f", onWash: "#c8d96b", wash: "#c8d96b1e" },
    light: { accent: "#5f6f1e", ink: "#f7f8f0", onWash: "#525f18", wash: "#5f6f1e1e" },
  },
  {
    id: "yellow",
    label: "Yellow",
    dark: { accent: "#f2d64b", ink: "#1a1503", onWash: "#f2d64b", wash: "#f2d64b1e" },
    light: { accent: "#6f5d00", ink: "#fbf9ea", onWash: "#645400", wash: "#6f5d001e" },
  },
  {
    id: "orange",
    label: "Orange",
    dark: { accent: "#f5a24a", ink: "#1c1204", onWash: "#f5a24a", wash: "#f5a24a1e" },
    light: { accent: "#9a4a00", ink: "#fdf6ee", onWash: "#8b4300", wash: "#9a4a001e" },
  },
  {
    id: "cyan",
    label: "Cyan",
    dark: { accent: "#6fdbe8", ink: "#04181a", onWash: "#6fdbe8", wash: "#6fdbe81e" },
    light: { accent: "#00646e", ink: "#eefcfe", onWash: "#005a63", wash: "#00646e1e" },
  },
  {
    id: "green",
    label: "Green",
    dark: { accent: "#7fe08a", ink: "#051706", onWash: "#7fe08a", wash: "#7fe08a1e" },
    light: { accent: "#256b33", ink: "#f0fbf2", onWash: "#21602e", wash: "#256b331e" },
  },
  {
    id: "pink",
    label: "Pink",
    dark: { accent: "#f49ac1", ink: "#1d0711", onWash: "#f49ac1", wash: "#f49ac11e" },
    light: { accent: "#96325f", ink: "#fdf1f6", onWash: "#872d56", wash: "#96325f1e" },
  },
];

export const DEFAULT_ACCENT: AccentId = "lichen";

/** Maximum alpha of the accent wash; 0x1e is 11.8%, under the 12% ceiling. */
export const WASH_ALPHA = 0x1e / 0xff;

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
