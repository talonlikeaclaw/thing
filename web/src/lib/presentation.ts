import type { PropertyDisplay, PropertyFormat } from "@/api/types";

/**
 * The one number grammar: every surface that shows a number turns it into text
 * here, so a cell, a copied cell and a footer total cannot disagree.
 *
 * A display is presentation and never storage. The server keeps sending the
 * plain label, the stored value stays the raw JSON number, and a sort, a filter
 * and a CSV cell read that raw number — only the text a reader sees comes from
 * this module.
 */

/** How a value sits in its column. */
export type Alignment = "left" | "right";

/** The narrowest shape a number needs to know about its property. */
export interface Displayed {
  format?: PropertyFormat;
  display?: PropertyDisplay;
}

/**
 * The currency codes this runtime knows, when it can say. `Intl` does not raise
 * for an unknown-but-well-formed code — it prints `ZZZ 1,204.00` — so the list,
 * not a `try`, is what decides whether a display can be honoured. `null` means
 * this runtime cannot enumerate them; the formatter's own behaviour then rules.
 */
const SUPPORTED_CURRENCIES: ReadonlySet<string> | null = supportedCurrencies();

/**
 * The ISO 4217 codes this runtime knows, sorted for the authoring list. Empty
 * when the runtime cannot enumerate them; the field then offers none.
 */
export function currencyCodes(): readonly string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  if (typeof intl.supportedValuesOf !== "function") {
    return [];
  }
  try {
    return [...intl.supportedValuesOf("currency")].sort();
  } catch {
    return [];
  }
}

function supportedCurrencies(): ReadonlySet<string> | null {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  if (typeof intl.supportedValuesOf !== "function") {
    return null;
  }
  try {
    return new Set(intl.supportedValuesOf("currency"));
  } catch {
    return null;
  }
}

/**
 * A number as its display asks for it, or `null` when the display asks for
 * nothing this module can honour — no block, only an alignment (or the default
 * `grouping: true`), a non-finite value, or a currency code this runtime does
 * not know. The caller then keeps the server's label rather than guessing.
 *
 * `locale` is for tests and for a caller that knows better than the browser;
 * the running app passes nothing and takes the reader's own separators.
 */
export function numberText(
  value: number,
  display?: PropertyDisplay,
  locale?: string,
): string | null {
  if (!display || !Number.isFinite(value)) {
    return null;
  }
  const { currency, decimals, grouping } = display;
  // `grouping: true` is what an absent grouping means, so it is not a request.
  if (currency === undefined && decimals === undefined && grouping !== false) {
    return null;
  }
  if (currency !== undefined && SUPPORTED_CURRENCIES && !SUPPORTED_CURRENCIES.has(currency)) {
    return null;
  }
  const options: Intl.NumberFormatOptions = { useGrouping: grouping ?? true };
  if (currency !== undefined) {
    options.style = "currency";
    options.currency = currency;
    if (decimals !== undefined) {
      options.minimumFractionDigits = decimals;
      options.maximumFractionDigits = decimals;
    }
  } else if (decimals !== undefined) {
    options.minimumFractionDigits = decimals;
    options.maximumFractionDigits = decimals;
  } else {
    // The value's own digits, up to the formatter's own limit.
    options.minimumFractionDigits = 0;
    options.maximumFractionDigits = 20;
  }
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    // A well-formed code this runtime does not know: no text to invent.
    return null;
  }
}

/**
 * What a cell shows: the display's text when it has one, else the server's
 * label. Only a number is re-derived; every other format's label is already
 * the reading its editor and its options define.
 */
export function displayLabel(def: Displayed, value: unknown, serverLabel: string): string {
  if (def.format !== "number" || typeof value !== "number") {
    return serverLabel;
  }
  return numberText(value, def.display) ?? serverLabel;
}

/**
 * Which edge a data cell's text sits against: the display's own edge, else
 * right for a number and left for everything else.
 */
export function alignOf(def: Displayed): Alignment {
  const align = def.display?.align;
  if (align === "left" || align === "right") {
    return align;
  }
  return def.format === "number" ? "right" : "left";
}
