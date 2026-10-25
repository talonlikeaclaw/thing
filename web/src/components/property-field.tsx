import { Popover } from "@base-ui/react/popover";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { useState } from "react";

import { useRelationChoices, useUpdateProperty } from "@/api/queries";
import type { PropertyDef } from "@/api/types";
import { ThumbRow, useHandedness } from "@/components/handedness";
import { RecurrenceInput } from "@/components/recurrence-input";
import { cn } from "@/lib/cn";
import { formatDateTime, readError, shortId } from "@/lib/display";
import { datetimeLocal, fromDatetimeLocal, inputText, isBlank, isChecked, optionName } from "@/lib/format";
import { todayIn } from "@/lib/timezone";
import { optionDrafts, optionInputs } from "@/lib/schema";

interface PropertyFieldProps {
  spaceId: string;
  property: PropertyDef;
  /** The raw JSON value, as frontmatter stores it. */
  value: unknown;
  /** The server's label for the current value, used when the field is read-only. */
  label: string;
  canEdit: boolean;
  /** A reason the field is read-only even for an editor; shown under the value. */
  locked?: string;
  /** The space's calendar zone, used by the date shortcuts. */
  timeZone?: string;
  /** The server says a relation points at a record this reader cannot see. */
  missing?: boolean;
  onChange: (value: unknown | null) => void;
  /** A field whose text cannot be saved (a half-typed number) disables Save. */
  onInvalid: (invalid: boolean) => void;
}

const control =
  "h-10 w-full rounded-field border border-line-interactive bg-ground px-3 text-[15px] text-ink transition-colors hover:border-line-strong focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]";

/**
 * One property in the record panel: an input per format, bound to the panel's
 * draft. Unlike a table cell there is no commit-on-blur — the panel's Save
 * sends every changed field in one write, so one edit is one revision.
 */
export function PropertyField(props: PropertyFieldProps) {
  if (!props.canEdit) {
    return (
      <ReadOnlyValue
        property={props.property}
        value={props.value}
        label={props.label}
        timeZone={props.timeZone}
      />
    );
  }

  if (props.locked) {
    return (
      <div className="grid gap-1">
        <ReadOnlyValue property={props.property} value={props.value} label={props.label} />
        <span className="text-[12px] text-faint">{props.locked}</span>
      </div>
    );
  }

  switch (props.property.format) {
    case "checkbox":
      return <CheckboxField {...props} />;
    case "select":
      return <SelectField {...props} />;
    case "multi_select":
      return <MultiSelectField {...props} />;
    case "relation":
      return <RelationField {...props} />;
    case "recurrence":
      return (
        <RecurrenceInput
          value={props.value}
          onApply={(next) => props.onChange(next)}
        />
      );
    default:
      return <TextField {...props} />;
  }
}

function ReadOnlyValue({
  property,
  value,
  label,
  timeZone,
}: {
  property: PropertyDef;
  value: unknown;
  label: string;
  timeZone?: string;
}) {
  if (property.format === "checkbox") {
    return isChecked(value) ? (
      <span className="inline-flex items-center gap-1.5 text-[14px] text-accent">
        <Check aria-hidden size={13} />
        Yes
      </span>
    ) : (
      <span className="text-faint">—</span>
    );
  }
  if (isBlank(value) || label === "") {
    return <span className="text-faint">—</span>;
  }
  if (property.format === "select" && typeof value === "string") {
    const option = property.options?.find((known) => known.key === value);
    return (
      <span className="inline-flex items-center gap-1.5 text-[14px]">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full border border-line-strong"
          style={option ? { backgroundColor: option.color } : undefined}
        />
        {optionName(property, value)}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "text-[14px]",
        (property.format === "number" ||
          property.format === "date" ||
          property.format === "datetime") &&
          "tnum",
        property.format === "relation" && "font-mono text-[12.5px]",
      )}
    >
      {property.format === "datetime" && typeof value === "string"
        ? formatDateTime(value, timeZone)
        : label}
    </span>
  );
}

function TextField({
  property,
  value,
  onChange,
  onInvalid,
  timeZone,
}: PropertyFieldProps) {
  const format = property.format;
  const initial =
    format === "datetime"
      ? datetimeLocal(value)
      : format === "number"
        ? typeof value === "number"
          ? String(value)
          : ""
        : inputText(value);
  const [text, setText] = useState(initial);
  const [invalid, setInvalid] = useState(false);

  function change(next: string) {
    setText(next);
    if (format === "number") {
      const trimmed = next.trim();
      if (trimmed === "") {
        setInvalid(false);
        onInvalid(false);
        onChange(null);
        return;
      }
      const number = Number(trimmed);
      if (!Number.isFinite(number)) {
        setInvalid(true);
        onInvalid(true);
        return;
      }
      setInvalid(false);
      onInvalid(false);
      onChange(number);
      return;
    }
    setInvalid(false);
    onInvalid(false);
    if (format === "datetime") {
      onChange(fromDatetimeLocal(next));
      return;
    }
    onChange(next === "" ? null : next);
  }

  const type =
    format === "number"
      ? "number"
      : format === "date"
        ? "date"
        : format === "datetime"
          ? "datetime-local"
          : format === "url"
            ? "url"
            : format === "email"
              ? "email"
              : "text";

  return (
    <div className="grid max-w-[32rem] gap-1">
      <input
        aria-label={property.name}
        aria-invalid={invalid || undefined}
        className={cn(control, invalid && "border-danger")}
        type={type}
        step={format === "number" ? "any" : undefined}
        value={text}
        onChange={(event) => change(event.target.value)}
        placeholder={format === "url" ? "https://…" : undefined}
      />
      {invalid ? (
        <p role="alert" className="text-[12px] text-danger">
          Enter a number.
        </p>
      ) : null}
      {format === "date" || format === "datetime" ? (
        <ThumbRow className="flex-wrap items-center gap-3">
          <button
            type="button"
            className="text-[12px] text-muted underline decoration-line-strong hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-2 pointer-coarse:text-[13px] max-sm:min-h-11 max-sm:min-w-11 max-sm:px-2 max-sm:text-[13px]"
            onClick={() => {
              setText("");
              setInvalid(false);
              onInvalid(false);
              onChange(null);
            }}
          >
            Clear
          </button>
          <button
            type="button"
            className="text-[12px] text-muted underline decoration-line-strong hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-2 pointer-coarse:text-[13px] max-sm:min-h-11 max-sm:min-w-11 max-sm:px-2 max-sm:text-[13px]"
            onClick={() => {
              const zone =
                timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
              const next =
                format === "date" ? todayIn(zone) : datetimeLocal(new Date().toISOString());
              setText(next);
              setInvalid(false);
              onInvalid(false);
              onChange(format === "date" ? next : fromDatetimeLocal(next));
            }}
          >
            {format === "date" ? "Today" : "Now"}
          </button>
        </ThumbRow>
      ) : null}
    </div>
  );
}

function CheckboxField({ property, value, onChange }: PropertyFieldProps) {
  return (
    <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-[14px] pointer-coarse:min-h-11">
      <input
        type="checkbox"
        aria-label={property.name}
        className="h-4 w-4 accent-accent"
        checked={isChecked(value)}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="text-muted">{isChecked(value) ? "Checked" : "Not checked"}</span>
    </label>
  );
}

/** A button showing the value, a popup with every option, and create-on-type. */
function SelectField({ spaceId, property, value, onChange }: PropertyFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const create = useUpdateProperty(spaceId, property.key);
  const selected = property.options?.find((option) => option.key === value);
  const needle = query.trim().toLowerCase();
  const options = (property.options ?? []).filter(
    (option) =>
      !needle ||
      option.name.toLowerCase().includes(needle) ||
      option.key.toLowerCase().includes(needle),
  );
  const exact = (property.options ?? []).some(
    (option) => option.name.toLowerCase() === needle,
  );

  function choose(key: string) {
    onChange(key === "" ? null : key);
    setOpen(false);
    setQuery("");
  }

  function createOption() {
    const name = query.trim();
    if (!name) {
      return;
    }
    create.mutate(
      { options: [...optionInputs(optionDrafts(property.options)), { name }] },
      {
        onSuccess: (saved) => {
          const created = saved.options?.find((option) => option.name === name);
          if (created) {
            choose(created.key);
          }
        },
      },
    );
  }

  return (
    <div className="max-w-[22rem]">
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setQuery("");
          }
        }}
      >
        <Popover.Trigger
          type="button"
          aria-haspopup="listbox"
          aria-label={property.name}
          className={cn(control, "flex items-center justify-between gap-2 text-left")}
        >
          {selected ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full border border-line-strong"
                style={{ backgroundColor: selected.color }}
              />
              <span className="truncate">{selected.name}</span>
            </span>
          ) : (
            <span className="text-faint">Choose or type</span>
          )}
          <ChevronDown aria-hidden size={15} className="shrink-0 text-muted" />
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Positioner sideOffset={4} collisionPadding={8} className="z-50">
            <Popover.Popup
              aria-label={`${property.name} options`}
              className="w-[var(--anchor-width)] min-w-[15rem] max-w-[calc(100vw-1rem)] rounded-field border border-line bg-surface p-1 text-[13px]"
            >
              <input
                autoFocus
                aria-label={`Filter ${property.name} options`}
                className="mb-1 h-8 w-full rounded-[4px] border border-line-interactive bg-ground px-2 text-[13px] outline-none focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]"
                placeholder="Filter or type a new option"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                    setQuery("");
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const match = options[0];
                    if (match) {
                      choose(match.key);
                    } else if (query.trim()) {
                      createOption();
                    }
                  }
                }}
              />
              <div className="max-h-56 overflow-auto">
                {value !== null && value !== undefined ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded-[3px] px-2 py-1.5 text-left text-faint hover:bg-raised hover:text-ink"
                    onClick={() => choose("")}
                  >
                    <X aria-hidden size={12} />
                    Clear
                  </button>
                ) : null}
                {options.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-[3px] px-2 py-1.5 text-left hover:bg-raised"
                    onClick={() => choose(option.key)}
                  >
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full border border-line-strong"
                        style={{ backgroundColor: option.color }}
                      />
                      <span className="truncate">{option.name}</span>
                    </span>
                    <span className="font-mono text-[10px] text-faint">{option.key}</span>
                  </button>
                ))}
                {query.trim() && !exact ? (
                  <button
                    type="button"
                    disabled={create.isPending}
                    className="flex w-full items-center gap-1.5 rounded-[3px] px-2 py-1.5 text-left text-accent hover:bg-raised disabled:opacity-50"
                    onClick={createOption}
                  >
                    <Plus aria-hidden size={12} />
                    {create.isPending ? "Creating…" : `Create “${query.trim()}”`}
                  </button>
                ) : null}
              </div>
              {create.error ? (
                <p role="alert" className="px-2 py-1 text-[12px] text-danger">
                  {readError(create.error)}
                </p>
              ) : null}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function MultiSelectField({ property, value, onChange }: PropertyFieldProps) {
  const selected = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  const options = property.options ?? [];

  return (
    <div className="grid max-w-[28rem] gap-1 rounded-field border border-line bg-ground p-2">
      {options.length === 0 ? (
        <p className="px-1 py-1 text-[12px] text-muted">
          No options yet; add them in the schema.
        </p>
      ) : (
        options.map((option) => {
          const checked = selected.includes(option.key);
          return (
            <label
              key={option.key}
              className="flex cursor-pointer items-center gap-2 rounded-[3px] px-1 py-1 text-[13px] hover:bg-raised pointer-coarse:min-h-11"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={checked}
                onChange={() => {
                  const next = checked
                    ? selected.filter((key) => key !== option.key)
                    : [...selected, option.key];
                  onChange(next.length === 0 ? null : next);
                }}
              />
              {option.name}
            </label>
          );
        })
      )}
    </div>
  );
}

/** Single and multi relations: search the space's objects and pick targets. */
function RelationField({ spaceId, property, value, onChange }: PropertyFieldProps) {
  const { choices, loading } = useRelationChoices(spaceId, property, true);
  const { handedness } = useHandedness();
  const [query, setQuery] = useState("");
  const multi = property.multi === true;
  const selected = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];
  const needle = query.trim().toLowerCase();
  const visible = choices.filter((choice) => choice.title.toLowerCase().includes(needle));
  const known = new Set(choices.map((choice) => choice.id));
  const absent = loading ? [] : selected.filter((id) => !known.has(id));

  function remove(id: string) {
    if (!multi) {
      onChange(null);
      return;
    }
    const next = selected.filter((item) => item !== id);
    onChange(next.length === 0 ? null : next);
  }

  function toggle(id: string) {
    if (!multi) {
      onChange(id);
      return;
    }
    const next = selected.includes(id)
      ? selected.filter((item) => item !== id)
      : [...selected, id];
    onChange(next.length === 0 ? null : next);
  }

  return (
    <div className="grid max-w-[30rem] gap-1 rounded-field border border-line bg-ground p-2">
      <input
        aria-label={`Filter ${property.name} targets`}
        className="h-8 w-full rounded-[4px] border border-line-interactive bg-ground px-2 text-[13px] outline-none focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]"
        placeholder={multi ? "Filter targets" : "Search targets"}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {absent.length > 0 ? (
        <ul aria-label="Missing targets" className="grid gap-0.5 border-b rule pb-1">
          {absent.map((id) => (
            <li key={id} className="flex items-center justify-between gap-2 px-1 py-0.5 text-[12px]">
              <span className="min-w-0 truncate text-warning">
                Missing target <span className="font-mono text-[11px]">{shortId(id)}</span>
              </span>
              <button
                type="button"
                className="shrink-0 text-[11px] text-muted underline decoration-line-strong hover:text-ink pointer-coarse:min-h-11"
                onClick={() => remove(id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="max-h-48 overflow-auto">
        {loading ? (
          <p className="px-1 py-1 text-[12px] text-muted">Reading targets…</p>
        ) : visible.length === 0 ? (
          <p className="px-1 py-1 text-[12px] text-muted">No matching records.</p>
        ) : (
          visible.map((choice) => {
            const picked = selected.includes(choice.id);
            return (
              <button
                key={choice.id}
                type="button"
                aria-pressed={multi ? picked : undefined}
                className={cn(
                  "flex w-full items-baseline justify-between gap-2 rounded-[3px] px-1 py-1.5 text-left text-[13px] hover:bg-raised pointer-coarse:min-h-11",
                  picked && "text-accent",
                )}
                onClick={() => toggle(choice.id)}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {picked ? <Check aria-hidden size={12} /> : null}
                  <span className="truncate">{choice.title}</span>
                </span>
                <span className="font-mono text-[10px] text-faint">{choice.type}</span>
              </button>
            );
          })
        )}
      </div>
      {selected.length > 0 ? (
        <button
          type="button"
          className={cn(
            "border-t rule pt-1 text-[12px] text-faint hover:text-ink pointer-coarse:min-h-11 pointer-coarse:text-[13px] max-sm:min-h-11 max-sm:text-[13px]",
            handedness === "left" ? "text-left" : "text-right",
          )}
          onClick={() => onChange(null)}
        >
          Clear relation
        </button>
      ) : null}
    </div>
  );
}
