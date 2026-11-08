import { Popover } from "@base-ui/react/popover";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from "react";

import { cn } from "@/lib/cn";
import { useCoarsePointer, useCompactWidth } from "@/lib/media";

/** One row of the list: an option's key, a target's id, and what it reads as. */
export interface Choice {
  id: string;
  label: string;
  /** A short mono note beside the label, e.g. a key or a record type. */
  hint?: string;
}

const TRIGGER =
  "flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-[10px] border border-line-interactive/70 bg-raised/40 px-2 text-left text-[12px] text-ink transition-colors hover:border-line-strong focus:border-accent aria-expanded:border-accent disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:h-11 pointer-coarse:text-[16px]";

const ROW =
  "flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-[12px] transition-colors pointer-coarse:min-h-11";

interface ChoicePickerProps {
  choices: Choice[];
  /** One id, or a list of ids when the operator takes several values. */
  value: unknown;
  multiple: boolean;
  onChange: (value: unknown) => void;
  /** The field's accessible name; the search field is `Search <label>`. */
  label: string;
  /** Shown on the field before anything is chosen. */
  placeholder?: string;
  /** The target read is still in flight. */
  loading?: boolean;
  className?: string;
}

/**
 * One value from a searchable list, in the project's own field: a pill that
 * opens a glass list on a fine pointer, and the list itself inside a sheet on a
 * phone. Arrow keys move a highlighted row, Enter chooses it, Escape closes.
 */
export function ChoicePicker({
  choices,
  value,
  multiple,
  onChange,
  label,
  placeholder = "Choose a value",
  loading = false,
  className,
}: ChoicePickerProps) {
  const compact = useCompactWidth();
  const coarse = useCoarsePointer();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const selected = selectedIds(value);
  const rows = choices.map((choice) => ({
    ...choice,
    picked: selected.includes(choice.id),
  }));

  function pick(id: string) {
    if (!multiple) {
      onChange(id);
      setOpen(false);
      return;
    }
    const next = selected.includes(id)
      ? selected.filter((item) => item !== id)
      : [...selected, id];
    onChange(next.length === 0 ? null : next);
  }

  const list = (fieldRef?: Ref<HTMLInputElement>) => (
    <ChoiceList
      label={label}
      choices={rows}
      loading={loading}
      onPick={pick}
      fieldRef={fieldRef}
    />
  );

  // A phone's filter already lives in a sheet; a second overlay would stack two
  // keyboards. The list renders in the row instead.
  if (compact || coarse) {
    return (
      <div
        className={cn(
          "grid min-w-0 flex-1 gap-1 rounded-[10px] border border-line-interactive/70 bg-raised/40 p-2",
          className,
        )}
      >
        {list()}
      </div>
    );
  }

  const unresolved = selected.some((id) => !choices.some((choice) => choice.id === id));
  const text =
    loading && (selected.length === 0 || unresolved)
      ? "Reading values…"
      : selected.length === 0
        ? placeholder
        : joinedLabel(choices, selected);

  return (
    <div className={cn("min-w-0 flex-1", className)}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger aria-label={label} title={text} className={TRIGGER}>
          <span className={cn("truncate", selected.length === 0 && "text-muted")}>{text}</span>
          <ChevronDown aria-hidden size={13} className="shrink-0 text-faint" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={4} align="start" collisionPadding={8} className="z-50">
            <Popover.Popup
              aria-label={label}
              initialFocus={() => inputRef.current ?? true}
              className="glass-strong w-[18rem] max-w-[calc(100vw-2rem)] rounded-card p-1.5"
            >
              {list(inputRef)}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

/** The ids a value carries, whatever shape the condition holds. */
function selectedIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" ? [value] : [];
}

/** The chosen rows as one readable line; an unread id still names itself. */
function joinedLabel(choices: readonly Choice[], selected: readonly string[]): string {
  return selected
    .map((id) => choices.find((choice) => choice.id === id)?.label ?? id)
    .join(", ");
}

interface ChoiceListProps {
  label: string;
  choices: (Choice & { picked: boolean })[];
  loading: boolean;
  onPick: (id: string) => void;
  /** The overlay focuses the search field on open. */
  fieldRef?: Ref<HTMLInputElement>;
}

function ChoiceList({
  label,
  choices,
  loading,
  onPick,
  fieldRef,
}: ChoiceListProps) {
  const base = useId();
  const listId = `${base}-list`;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const needle = query.trim().toLowerCase();
  const rows = choices.filter(
    (choice) =>
      needle === "" ||
      choice.label.toLowerCase().includes(needle) ||
      (choice.hint ?? "").toLowerCase().includes(needle),
  );
  const index = rows.length === 0 ? -1 : Math.min(active, rows.length - 1);
  const activeRow = index === -1 ? undefined : rows[index];

  useEffect(() => {
    if (!activeRow) {
      return;
    }
    document
      .getElementById(`${base}-option-${activeRow.id}`)
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
        onPick(activeRow.id);
      }
    }
  }

  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex items-center gap-1.5 border-b rule px-1 pb-1.5">
        <Search aria-hidden size={12} className="shrink-0 text-faint" />
        <input
          ref={fieldRef}
          role="combobox"
          aria-expanded
          aria-haspopup="listbox"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeRow ? `${base}-option-${activeRow.id}` : undefined}
          aria-label={`Search ${label.toLowerCase()}`}
          placeholder="Search values."
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-7 min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint pointer-coarse:h-11 pointer-coarse:text-[16px]"
        />
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label={label}
        className={cn("max-h-40 overflow-y-auto overscroll-contain", loading && "min-h-24")}
      >
        {loading ? (
          <p className="px-2 py-3 text-[12px] text-muted">Reading values…</p>
        ) : rows.length === 0 ? (
          <p className="px-2 py-3 text-[12px] text-muted">
            {needle === "" ? "No values to choose from." : `No value matches “${query.trim()}”.`}
          </p>
        ) : (
          rows.map((choice, at) => {
            const on = at === index;
            return (
              <div
                key={choice.id}
                id={`${base}-option-${choice.id}`}
                role="option"
                aria-selected={on}
                className={cn(
                  ROW,
                  on ? "bg-accent-wash text-accent-on-wash" : "text-ink hover:bg-raised/60",
                )}
                onMouseEnter={() => setActive(at)}
                onClick={() => onPick(choice.id)}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  {choice.picked ? (
                    <Check aria-hidden size={12} className="shrink-0 text-accent" />
                  ) : (
                    <span aria-hidden className="w-3 shrink-0" />
                  )}
                  <span className="truncate">{choice.label}</span>
                </span>
                {choice.hint ? (
                  <span className="max-w-[45%] shrink-0 truncate font-mono text-[11px] text-faint">
                    {choice.hint}
                  </span>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
