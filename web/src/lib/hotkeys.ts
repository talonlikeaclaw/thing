import { useEffect, useRef } from "react";

/** One global binding; `mod` means Command on Apple platforms, Control elsewhere. */
export interface HotkeyBinding {
  key: string;
  mod?: boolean;
  /** Escape must work while a field has focus; other plain keys must not. */
  allowInInput?: boolean;
  run: (event: KeyboardEvent) => void;
}

export type ShortcutScope = "Global" | "Space" | "Table" | "Record";

/** One advertised shortcut. The listener and the sheet read the same list. */
export interface ShortcutDescriptor {
  id: string;
  key: string;
  mod?: boolean;
  allowInInput?: boolean;
  keys: string;
  label: string;
  scope: ShortcutScope;
}

/**
 * Every shortcut the app currently registers. Adding a binding means adding
 * one descriptor here; the `?` sheet renders this list, so it can never
 * advertise a key that does nothing.
 */
export const SHORTCUTS: ShortcutDescriptor[] = [
  {
    id: "palette",
    key: "k",
    mod: true,
    allowInInput: true,
    keys: "⌘K / Ctrl K",
    label: "Open the command palette",
    scope: "Global",
  },
  {
    id: "capture",
    key: "c",
    keys: "C",
    label: "Capture a record",
    scope: "Space",
  },
  {
    id: "shortcuts",
    key: "?",
    keys: "?",
    label: "Show this shortcut sheet",
    scope: "Global",
  },
  {
    id: "escape",
    key: "escape",
    allowInInput: true,
    keys: "Esc",
    label: "Close the open overlay",
    scope: "Global",
  },
];

export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /mac|iphone|ipad|ipod/i.test(`${navigator.platform} ${navigator.userAgent}`);
}

/** The key cap a shortcut shows: `⌘K` on Apple, `Ctrl K` elsewhere. */
export function hotkeyLabel(key: string, mod = false): string {
  const cap = key.length === 1 ? key.toUpperCase() : key;
  if (!mod) {
    return cap;
  }
  return isApplePlatform() ? `⌘${cap}` : `Ctrl ${cap}`;
}

/** Whether a keydown began inside a field that owns its own keys. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return target.closest("input, textarea, select, [contenteditable='true']") !== null;
}

/**
 * Registers one keydown listener for every global binding and returns the
 * platform label of the first `mod` binding, for the header button.
 *
 * Bindings are read from a ref so opening an overlay does not tear down the
 * listener and re-register it mid-keypress.
 */
export function useGlobalHotkeys(bindings: HotkeyBinding[], enabled = true): string {
  const latest = useRef(bindings);
  latest.current = bindings;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const listener = (event: KeyboardEvent) => {
      // A surface that already handled the key owns it, and a held toggle must
      // not strobe the overlay.
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      const pressed = event.key.toLowerCase();
      const inDialog =
        event.target instanceof HTMLElement && event.target.closest('[role="dialog"]') !== null;
      for (const binding of latest.current) {
        if (binding.key.toLowerCase() !== pressed) {
          continue;
        }
        const apple = isApplePlatform();
        const modifier = apple ? event.metaKey : event.ctrlKey;
        if (binding.mod) {
          if (!modifier || event.altKey) {
            continue;
          }
        } else if (event.metaKey || event.ctrlKey || event.altKey) {
          continue;
        }
        if (!binding.allowInInput && (isEditableTarget(event.target) || inDialog)) {
          continue;
        }
        event.preventDefault();
        binding.run(event);
        break;
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [enabled]);

  const first = bindings.find((binding) => binding.mod);
  return first ? hotkeyLabel(first.key, true) : "";
}
