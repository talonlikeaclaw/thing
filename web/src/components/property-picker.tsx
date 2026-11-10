import { Dialog } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from "react";

import type { PropertyDef } from "@/api/types";
import { useThumbHandedness } from "@/components/handedness";
import { FormatChip } from "@/components/ui/page";
import {
  SheetCloseButton,
  SheetHeader,
  SheetPopup,
  SheetTitle,
  SheetViewport,
} from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { useCoarsePointer, useCompactWidth } from "@/lib/media";
import { groupProperties, searchProperties } from "@/lib/property-search";
import { formatLabel } from "@/lib/schema";

/** No context carries nothing; one shared set keeps the split allocation-free. */
const NO_CARRIED: ReadonlySet<string> = new Set<string>();

const TRIGGER =
  "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-[10px] border border-line-interactive/70 bg-raised/40 px-3 text-left text-[13px] text-ink transition-colors hover:border-line-strong focus:border-accent aria-expanded:border-accent disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:h-11";

const ROW =
  "flex cursor-pointer items-start gap-2 rounded-[10px] px-2 py-1.5 transition-colors pointer-coarse:min-h-11";

interface PropertyPickerProps {
  /** Every property the picker may choose from. */
  properties: readonly PropertyDef[];
  /** The chosen key, or `null` before a choice. */
  value: string | null;
  onChange: (key: string) => void;
  /** Keys the caller's context already carries; they list first. */
  carried?: ReadonlySet<string>;
  /** A second line under the name, when the caller knows something extra. */
  meta?: (property: PropertyDef) => string | null | undefined;
  /** The field label above a `popover` trigger; the trigger's accessible name. */
  label?: string;
  /** Shown on the trigger before a property is chosen. */
  placeholder?: string;
  /** The sheet header's title on a phone. */
  title?: string;
  disabled?: boolean;
  /**
   * `popover` owns a trigger and its overlay; `list` is the body of an overlay
   * the caller already owns, which must supply its own chrome and close.
   */
  variant?: "popover" | "list";
  /** Focus the search field on mount; the list variant's callers ask for it. */
  autoFocus?: boolean;
  /** Called on Escape and, in the list variant, once a property is chosen. */
  onClose?: () => void;
  className?: string;
}

/**
 * One searchable property list, in a popover on a fine pointer and the shared
 * sheet on a phone. Every surface that chooses a property uses this component,
 * so the rows, the matching and the keyboard behave the same everywhere.
 */
export function PropertyPicker({
  properties,
  value,
  onChange,
  carried,
  meta,
  label,
  placeholder = "Choose property",
  title = "Choose property",
  disabled = false,
  variant = "popover",
  autoFocus = false,
  onClose,
  className,
}: PropertyPickerProps) {
  const compact = useCompactWidth();
  const coarse = useCoarsePointer();
  const handedness = useThumbHandedness();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const sheet = compact || coarse;
  const chosen = properties.find((property) => property.key === value) ?? null;

  const close = () => {
    setOpen(false);
    onClose?.();
  };

  if (variant === "list") {
    return (
      <PropertyList
        properties={properties}
        value={value}
        meta={meta}
        carried={carried}
        title={title}
        autoFocus={autoFocus}
        onChoose={(key) => {
          onChange(key);
          onClose?.();
        }}
        onClose={close}
        fieldRef={inputRef}
        className={className}
      />
    );
  }

  const trigger = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {chosen ? (
          <>
            <span className="truncate font-medium text-accent">{chosen.name}</span>
            <FormatChip>{formatLabel(chosen.format)}</FormatChip>
          </>
        ) : (
          <span className="truncate text-muted">{placeholder}</span>
        )}
      </span>
      <ChevronDown aria-hidden size={14} className="shrink-0 text-faint" />
    </>
  );

  const body = (
    <PropertyList
      properties={properties}
      value={value}
      meta={meta}
      carried={carried}
      title={title}
      onChoose={(key) => {
        onChange(key);
        close();
      }}
      onClose={close}
      fieldRef={inputRef}
    />
  );

  return (
    <div className={className}>
      {label ? <span className="label mb-1.5 block">{label}</span> : null}
      {sheet ? (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger
            aria-label={chosen ? `${label ?? title}: ${chosen.name}` : (label ?? title)}
            aria-expanded={open}
            disabled={disabled}
            className={TRIGGER}
          >
            {trigger}
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-40 scrim" />
            <SheetViewport>
              <SheetPopup
                className="sm:w-[34rem]"
                initialFocus={() => inputRef.current ?? true}
              >
                <SheetHeader
                  className={cn(
                    "gap-[var(--space-3)]",
                    handedness === "left" ? "justify-start" : "justify-between",
                  )}
                >
                  {handedness === "left" ? (
                    <>
                      <SheetCloseButton label="Close property picker" />
                      <SheetTitle className="min-w-0 flex-1 truncate">{title}</SheetTitle>
                    </>
                  ) : (
                    <>
                      <SheetTitle className="min-w-0 flex-1 truncate">{title}</SheetTitle>
                      <SheetCloseButton label="Close property picker" />
                    </>
                  )}
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--space-4)] py-[var(--space-3)] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                  {body}
                </div>
              </SheetPopup>
            </SheetViewport>
          </Dialog.Portal>
        </Dialog.Root>
      ) : (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger
            aria-label={chosen ? `${label ?? title}: ${chosen.name}` : (label ?? title)}
            aria-expanded={open}
            disabled={disabled}
            className={TRIGGER}
          >
            {trigger}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner sideOffset={6} align="start" className="z-50">
              <Popover.Popup
                aria-label={title}
                className="glass-strong w-[20rem] max-w-[calc(100vw-2rem)] rounded-card p-1.5"
              >
                {body}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}

interface PropertyListProps {
  properties: readonly PropertyDef[];
  value: string | null;
  onChoose: (key: string) => void;
  carried?: ReadonlySet<string>;
  meta?: (property: PropertyDef) => string | null | undefined;
  title: string;
  autoFocus?: boolean;
  onClose: () => void;
  /** The overlay owns focus; a sheet hands it the search field to focus. */
  fieldRef?: Ref<HTMLInputElement>;
  className?: string;
}

/**
 * The picker's content, with no positioning of its own: a search field, the
 * type's own properties, then the rest of the library. Arrow keys move the
 * active row, Enter chooses it, Escape closes the caller's overlay.
 */
function PropertyList({
  properties,
  value,
  onChoose,
  carried,
  meta,
  title,
  autoFocus = false,
  onClose,
  fieldRef,
  className,
}: PropertyListProps) {
  const base = useId();
  const listId = `${base}-list`;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const groups = useMemo(
    () => groupProperties(searchProperties(properties, query), carried ?? NO_CARRIED),
    [properties, query, carried],
  );
  const rows = useMemo(
    () => [...groups.onThisType, ...groups.inLibrary],
    [groups],
  );
  const index = rows.length === 0 ? -1 : Math.min(active, rows.length - 1);
  const activeRow = index === -1 ? undefined : rows[index];
  const grouped = groups.onThisType.length > 0 && groups.inLibrary.length > 0;

  useEffect(() => {
    if (!activeRow) {
      return;
    }
    document
      .getElementById(`${base}-option-${activeRow.key}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeRow, base]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (rows.length > 0) {
        setActive((index + 1) % rows.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length > 0) {
        setActive((index - 1 + rows.length) % rows.length);
      }
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(rows.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeRow) {
        setQuery("");
        onChoose(activeRow.key);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  const row = (property: PropertyDef, flatIndex: number) => {
    const selected = flatIndex === index;
    const description = meta?.(property);
    const isChosen = property.key === value;
    return (
      <div
        key={property.key}
        id={`${base}-option-${property.key}`}
        role="option"
        aria-selected={selected}
        className={cn(
          ROW,
          selected
            ? "bg-accent-wash text-accent-on-wash"
            : "text-ink hover:bg-raised/50",
        )}
        onMouseEnter={() => setActive(flatIndex)}
        onClick={() => {
          setQuery("");
          onChoose(property.key);
        }}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate font-medium text-accent">{property.name}</span>
          <span className="font-mono text-[11px] text-faint">{property.key}</span>
          {description ? (
            <span className="w-full text-[12px] text-muted">{description}</span>
          ) : null}
        </span>
        <FormatChip>{formatLabel(property.format)}</FormatChip>
        {isChosen ? (
          <Check aria-hidden size={14} className="mt-0.5 shrink-0 text-accent" />
        ) : null}
      </div>
    );
  };

  let offset = 0;
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-2 border-b rule px-1 pb-2">
        <Search aria-hidden size={14} className="shrink-0 text-faint" />
        <input
          ref={fieldRef}
          role="combobox"
          aria-expanded
          aria-haspopup="listbox"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeRow ? `${base}-option-${activeRow.key}` : undefined
          }
          aria-label={title}
          autoFocus={autoFocus}
          placeholder="Search properties."
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint pointer-coarse:h-11 pointer-coarse:text-base max-sm:h-11 max-sm:text-base"
        />
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label={title}
        className="mt-1 max-h-[min(20rem,50vh)] overflow-y-auto overscroll-contain"
      >
        {rows.length === 0 ? (
          <p className="px-2 py-4 text-[13px] text-muted">
            {query.trim() === ""
              ? "No properties to choose from."
              : `No property matches “${query.trim()}”.`}
          </p>
        ) : (
          <>
            {grouped ? (
              <div role="group" aria-label="On this type">
                <p aria-hidden className="label px-2 pt-1 pb-0.5">
                  On this type
                </p>
                {groups.onThisType.map((property) => {
                  const flatIndex = offset++;
                  return row(property, flatIndex);
                })}
              </div>
            ) : null}
            {grouped ? (
              <div role="group" aria-label="In this space">
                <p aria-hidden className="label px-2 pt-2 pb-0.5">
                  In this space
                </p>
                {groups.inLibrary.map((property) => {
                  const flatIndex = offset++;
                  return row(property, flatIndex);
                })}
              </div>
            ) : (
              rows.map((property) => row(property, offset++))
            )}
          </>
        )}
      </div>
    </div>
  );
}
