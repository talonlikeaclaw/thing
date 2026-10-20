import { Check, ChevronDown, Plus, X } from "lucide-react";
import { useState } from "react";

import { useRelationChoices, useUpdateProperty } from "@/api/queries";
import type { PropertyDef } from "@/api/types";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";
import { datetimeLocal, fromDatetimeLocal, inputText, isBlank, isChecked, optionName } from "@/lib/format";
import { optionDrafts, optionInputs } from "@/lib/schema";

interface PropertyFieldProps {
  spaceId: string;
  property: PropertyDef;
  /** The raw JSON value, as frontmatter stores it. */
  value: unknown;
  /** The server's label for the current value, used when the field is read-only. */
  label: string;
  canEdit: boolean;
  onChange: (value: unknown | null) => void;
  /** A field whose text cannot be saved (a half-typed number) disables Save. */
  onInvalid: (invalid: boolean) => void;
}

const control =
  "h-10 w-full rounded-field border border-line bg-ground px-3 text-[15px] text-ink transition-colors hover:border-line-strong focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]";

/**
 * One property in the record panel: an input per format, bound to the panel's
 * draft. Unlike a table cell there is no commit-on-blur — the panel's Save
 * sends every changed field in one write, so one edit is one revision.
 */
export function PropertyField(props: PropertyFieldProps) {
  if (!props.canEdit) {
    return <ReadOnlyValue property={props.property} value={props.value} label={props.label} />;
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
    default:
      return <TextField {...props} />;
  }
}

function ReadOnlyValue({
  property,
  value,
  label,
}: {
  property: PropertyDef;
  value: unknown;
  label: string;
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
      {label}
    </span>
  );
}

function TextField({
  property,
  value,
  onChange,
  onInvalid,
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
    <div
      className="relative max-w-[22rem]"
      onBlur={(event) => {
        if (
          !(
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          )
        ) {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={property.name}
        className={cn(control, "flex items-center justify-between gap-2 text-left")}
        onClick={() => setOpen((current) => !current)}
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
      </button>

      {open ? (
        <div className="absolute top-full left-0 z-30 mt-1 w-full min-w-[15rem] rounded-field border border-line bg-surface p-1 text-[13px]">
          <input
            autoFocus
            aria-label={`Filter ${property.name} options`}
            className="mb-1 h-8 w-full rounded-[4px] border border-line bg-ground px-2 text-[13px] outline-none focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]"
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
                onMouseDown={(event) => event.preventDefault()}
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
                onMouseDown={(event) => event.preventDefault()}
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
                onMouseDown={(event) => event.preventDefault()}
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
        </div>
      ) : null}
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
  const [query, setQuery] = useState("");
  const multi = property.multi === true;
  const selected = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];
  const needle = query.trim().toLowerCase();
  const visible = choices.filter((choice) => choice.title.toLowerCase().includes(needle));

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
        className="h-8 w-full rounded-[4px] border border-line bg-ground px-2 text-[13px] outline-none focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]"
        placeholder={multi ? "Filter targets" : "Search targets"}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
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
          className="border-t rule pt-1 text-left text-[12px] text-faint hover:text-ink"
          onClick={() => onChange(null)}
        >
          Clear relation
        </button>
      ) : null}
    </div>
  );
}
