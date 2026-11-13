import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import type { Align, PropertyDisplay, PropertyFormat } from "@/api/types";
import { SelectField, fieldFrame } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { currencyCodes } from "@/lib/presentation";

/**
 * The unauthorised form of a display: every setting as the control holds it.
 * The stored block is [displayPayload], so a default is never written twice.
 */
export interface DisplayDraft {
  align: Align;
  /** An ISO 4217 code, or `""` for no currency. */
  currency: string;
  /** A fraction-digit count, or `""` for the value's own digits. */
  decimals: string;
  grouping: boolean;
}

/** The three alignments, in the order a reader scans them. */
const ALIGNMENTS: { value: Align; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

const DECIMALS = ["", "0", "1", "2", "3", "4"].map((value) => ({
  value,
  label: value === "" ? "Auto" : value,
}));

const CURRENCIES = currencyCodes();

/** The draft a property with no display starts from. */
export function emptyDisplayDraft(): DisplayDraft {
  return { align: "auto", currency: "", decimals: "", grouping: true };
}

/** The draft a stored display describes. */
export function displayDraft(display: PropertyDisplay | undefined): DisplayDraft {
  const draft = emptyDisplayDraft();
  if (!display) {
    return draft;
  }
  return {
    align: display.align ?? "auto",
    currency: display.currency ?? "",
    decimals: display.decimals === undefined ? "" : String(display.decimals),
    grouping: display.grouping ?? true,
  };
}

/**
 * The block a write carries: absent when it would say only defaults, and
 * limited to the fields the format can honour. `null` is the clear a PATCH
 * sends; a create leaves the field out.
 */
export function displayPayload(
  draft: DisplayDraft,
  format: PropertyFormat,
): PropertyDisplay | null {
  const display: PropertyDisplay = {};
  if (draft.align !== "auto") {
    display.align = draft.align;
  }
  if (format === "number") {
    if (draft.currency !== "") {
      display.currency = draft.currency;
    }
    if (draft.decimals !== "") {
      display.decimals = Number(draft.decimals);
    }
    if (!draft.grouping) {
      display.grouping = false;
    }
  }
  return Object.keys(display).length === 0 ? null : display;
}

interface DisplayFieldsProps {
  draft: DisplayDraft;
  onChange: (draft: DisplayDraft) => void;
  /** The result format: only a number carries currency, decimals or grouping. */
  format: PropertyFormat;
  disabled?: boolean;
  idPrefix: string;
  /** Open the disclosure on a property that already says something. */
  initialOpen?: boolean;
}

/**
 * The one authoring form for a property's display. It is a disclosure because
 * most properties read plainly; the align choice is offered for every format,
 * the number grammar only for a number.
 */
export function DisplayFields({
  draft,
  onChange,
  format,
  disabled,
  idPrefix,
  initialOpen = false,
}: DisplayFieldsProps) {
  const base = useId();
  const controlsId = `${idPrefix}-display-${base}`;
  const [open, setOpen] = useState(initialOpen);
  const numeric = format === "number";

  function set<K extends keyof DisplayDraft>(key: K, value: DisplayDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-[12px] border border-line/70 bg-raised/30 px-3 py-2"
    >
      <summary className="label cursor-pointer py-1 select-none pointer-coarse:min-h-11">
        Display
      </summary>
      <div id={controlsId} className="mt-2 grid gap-4">
        <div>
          <span className="label mb-2 block">Alignment</span>
          <div
            role="radiogroup"
            aria-label="Alignment"
            className="inline-flex rounded-full border border-line p-0.5"
          >
            {ALIGNMENTS.map((choice) => {
              const selected = draft.align === choice.value;
              return (
                <button
                  key={choice.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  className={cn(
                    "min-h-8 rounded-full px-3 text-[12px] transition-colors pointer-coarse:min-h-11",
                    selected
                      ? "bg-accent-wash text-accent-on-wash"
                      : "text-muted hover:text-ink",
                  )}
                  onClick={() => set("align", choice.value)}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[12px] text-muted">
            Auto puts a number at the right edge and every other format at the left.
          </p>
        </div>

        {numeric ? (
          <>
            <div>
              <span className="label mb-2 block">Currency</span>
              <div className="relative">
                <Combobox.Root
                  items={CURRENCIES}
                  value={draft.currency === "" ? null : draft.currency}
                  onValueChange={(next) => {
                    if (typeof next === "string") {
                      set("currency", next);
                    }
                  }}
                  disabled={disabled}
                >
                  <Combobox.Input
                    aria-label="Currency"
                    placeholder="Search ISO codes, e.g. USD"
                    className={cn(
                      fieldFrame,
                      "h-[var(--field-fine)] pr-10 pl-3 font-mono pointer-coarse:h-[var(--field-coarse)]",
                    )}
                  />
                  <Combobox.Trigger
                    aria-label="Open currency list"
                    disabled={disabled}
                    className="absolute top-0 right-0 inline-flex h-10 w-10 items-center justify-center text-muted transition-colors hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
                  >
                    <ChevronDown aria-hidden size={16} />
                  </Combobox.Trigger>
                  <Combobox.Portal>
                    <Combobox.Positioner sideOffset={4} className="z-50">
                      <Combobox.Popup className="glass-strong w-[var(--anchor-width)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-card">
                        <Combobox.Empty>
                          <p className="px-3 py-3 text-[13px] text-muted">
                            No currency matches that code.
                          </p>
                        </Combobox.Empty>
                        <Combobox.List className="max-h-64 overflow-auto overscroll-contain p-1">
                          {(code: string) => (
                            <Combobox.Item
                              key={code}
                              value={code}
                              className="grid min-h-9 cursor-pointer grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded-[10px] px-2 py-1.5 font-mono text-[12.5px] text-ink select-none data-[highlighted]:bg-accent-wash data-[highlighted]:text-accent-on-wash pointer-coarse:min-h-11 pointer-coarse:text-[14px]"
                            >
                              <Combobox.ItemIndicator className="text-accent">
                                <Check aria-hidden size={13} />
                              </Combobox.ItemIndicator>
                              <span className="col-start-2 truncate">{code}</span>
                            </Combobox.Item>
                          )}
                        </Combobox.List>
                      </Combobox.Popup>
                    </Combobox.Positioner>
                  </Combobox.Portal>
                </Combobox.Root>
              </div>
              {draft.currency !== "" ? (
                <button
                  type="button"
                  disabled={disabled}
                  className="mt-1.5 text-[12px] text-muted underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink disabled:opacity-50 pointer-coarse:min-h-11"
                  onClick={() => set("currency", "")}
                >
                  Use no currency
                </button>
              ) : null}
            </div>

            <SelectField
              label="Decimals"
              value={draft.decimals}
              options={DECIMALS}
              onValueChange={(next) => set("decimals", next)}
              disabled={disabled}
              hint="Auto uses the currency's own minor units, or the value's digits when no currency is set."
            />

            <label className="flex min-h-9 items-center gap-2 text-[13px] text-ink pointer-coarse:min-h-11">
              <input
                type="checkbox"
                checked={draft.grouping}
                disabled={disabled}
                className="h-4 w-4 accent-[var(--color-accent)] pointer-coarse:h-5 pointer-coarse:w-5"
                onChange={(event) => set("grouping", event.target.checked)}
              />
              Thousands separators
            </label>
          </>
        ) : null}
      </div>
    </details>
  );
}
