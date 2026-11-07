import { Popover } from "@base-ui/react/popover";
import { CalendarDays, Check, ChevronDown, Plus, X } from "lucide-react";
import { useState } from "react";

import { useRelationChoices, useTypes, useUpdateProperty } from "@/api/queries";
import type { PropertyDef } from "@/api/types";
import { AttachmentField } from "@/components/attachment-field";
import { FileField } from "@/components/file-field";
import { ThumbRow, useThumbHandedness } from "@/components/handedness";
import { RecurrenceInput } from "@/components/recurrence-input";
import { cn } from "@/lib/cn";
import { formatDateTime, formatDay, readError, shortId } from "@/lib/display";
import { fileName, fileUrl, isImagePath, thumbnailUrl } from "@/lib/files";
import {
  datetimeLocal,
  fromDatetimeLocal,
  inputText,
  isBlank,
  isChecked,
  optionName,
  relationChips,
  typeLabel,
} from "@/lib/format";
import { todayIn } from "@/lib/timezone";
import { optionDrafts, optionInputs } from "@/lib/schema";

interface PropertyFieldProps {
  spaceId: string;
  property: PropertyDef;
  /** The raw JSON value, as frontmatter stores it. */
  value: unknown;
  /** The server's label for the current value: read-only text and relation chips. */
  label: string;
  canEdit: boolean;
  /** A reason the field is read-only even for an editor; shown under the value. */
  locked?: string;
  /** The space's calendar zone, used by the date shortcuts. */
  timeZone?: string;
  onChange: (value: unknown | null) => void;
  /** The record's current cover; the attachment tiles mark it and set it. */
  coverPath?: string;
  onSetCover?: (path: string) => void;
  /** A field whose text cannot be saved (a half-typed number) disables Save. */
  onInvalid: (invalid: boolean) => void;
}

const control =
  "h-10 w-full rounded-[10px] border border-line-interactive/70 bg-raised/40 px-3 text-[15px] text-ink transition-colors hover:border-line-strong focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]";

/** A datetime-local value in the record's one date grammar. */
function shownDateTime(local: string, timeZone?: string): string {
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? local : formatDateTime(at.toISOString(), timeZone);
}

/**
 * One property in the record panel: an input per format, bound to the panel's
 * draft. Unlike a table cell there is no commit-on-blur — the panel's Save
 * sends every changed field in one write, so one edit is one revision.
 */
export function PropertyField(props: PropertyFieldProps) {
  if (!props.canEdit) {
    return (
      <ReadOnlyValue
        spaceId={props.spaceId}
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
        <ReadOnlyValue
          spaceId={props.spaceId}
          property={props.property}
          value={props.value}
          label={props.label}
        />
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
    case "file":
    case "image":
      return (
        <FileField
          spaceId={props.spaceId}
          format={props.property.format === "image" ? "image" : "file"}
          value={props.value}
          disabled={!props.canEdit}
          coverPath={props.coverPath}
          onSetCover={props.onSetCover}
          onChange={props.onChange}
        />
      );
    case "attachments":
      return (
        <AttachmentField
          spaceId={props.spaceId}
          value={props.value}
          disabled={!props.canEdit}
          coverPath={props.coverPath}
          onSetCover={props.onSetCover}
          onChange={props.onChange}
        />
      );
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
  spaceId,
  property,
  value,
  label,
  timeZone,
}: {
  spaceId: string;
  property: PropertyDef;
  value: unknown;
  label: string;
  timeZone?: string;
}) {
  if (property.format === "file" || property.format === "image") {
    if (typeof value !== "string" || value === "") {
      return <span className="text-faint">—</span>;
    }
    const name = label !== "" && label !== value ? label : fileName(value);
    if (property.format === "image") {
      return (
        <a
          href={fileUrl(spaceId, value)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-full items-center gap-2 text-[14px] underline decoration-line-strong hover:decoration-ink"
        >
          <img
            src={thumbnailUrl(spaceId, value, 256)}
            alt=""
            className="size-12 shrink-0 rounded-[8px] object-cover"
          />
          <span className="truncate">{name}</span>
        </a>
      );
    }
    return (
      <a
        href={fileUrl(spaceId, value)}
        download={name}
        className="block max-w-full truncate text-[14px] underline decoration-line-strong hover:decoration-ink"
      >
        {name}
      </a>
    );
  }
  if (property.format === "attachments") {
    const entries = Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (entries.length === 0) {
      return <span className="text-faint">—</span>;
    }
    return (
      <ul className="grid gap-1.5">
        {entries.map((path) =>
          isImagePath(path) ? (
            <li key={path}>
              <a
                href={fileUrl(spaceId, path)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-2 text-[14px] underline decoration-line-strong hover:decoration-ink"
              >
                <img
                  src={thumbnailUrl(spaceId, path, 256)}
                  alt=""
                  className="size-12 shrink-0 rounded-[8px] object-cover"
                />
                <span className="truncate">{fileName(path)}</span>
              </a>
            </li>
          ) : (
            <li key={path}>
              <a
                href={fileUrl(spaceId, path)}
                download={fileName(path)}
                className="block max-w-full truncate text-[14px] underline decoration-line-strong hover:decoration-ink"
              >
                {fileName(path)}
              </a>
            </li>
          ),
        )}
      </ul>
    );
  }
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
  if (property.format === "date" && typeof value === "string") {
    return <span className="tnum text-[14px]">{formatDay(value)}</span>;
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

  const showsCalendar = format === "date" || format === "datetime";
  const shown =
    text === ""
      ? ""
      : format === "date"
        ? formatDay(text)
        : format === "datetime"
          ? shownDateTime(text, timeZone)
          : text;

  return (
    <div className="grid max-w-[32rem] gap-1">
      {showsCalendar ? (
        // The visible field and the native input are siblings, so the focus
        // ring lives on their shared wrapper: only an ancestor can answer
        // `:has(:focus-visible)` for the input that actually takes focus.
        <div className="relative rounded-field has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
          <div
            aria-hidden
            className={cn(
              control,
              "flex items-center justify-between gap-2",
              invalid && "border-danger",
            )}
          >
            <span className={cn("truncate", shown === "" && "text-faint")}>
              {shown === ""
                ? format === "date"
                  ? "Choose a date"
                  : "Choose a date and time"
                : shown}
            </span>
            <CalendarDays aria-hidden size={15} className="shrink-0 text-muted" />
          </div>
          <input
            aria-label={property.name}
            aria-invalid={invalid || undefined}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            type={type}
            value={text}
            onChange={(event) => change(event.target.value)}
            onClick={(event) => {
              const input = event.currentTarget;
              try {
                input.showPicker();
              } catch {
                // A browser may require a different gesture; the field still focuses.
              }
            }}
          />
        </div>
      ) : (
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
      )}
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
  const handedness = useThumbHandedness();
  return (
    <label className="block cursor-pointer text-[14px]">
      <ThumbRow
        className={cn(
          "min-h-10 w-full items-center gap-2 pointer-coarse:min-h-11",
          handedness === "right" && "justify-between",
        )}
      >
        <span className="text-muted">{isChecked(value) ? "Checked" : "Not checked"}</span>
        <input
          type="checkbox"
          aria-label={property.name}
          className="h-4 w-4 shrink-0 accent-accent"
          checked={isChecked(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
      </ThumbRow>
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
              className="glass-strong w-[var(--anchor-width)] min-w-[15rem] max-w-[calc(100vw-1rem)] rounded-card p-1.5 text-[13px]"
            >
              <input
                autoFocus
                aria-label={`Filter ${property.name} options`}
                className="mb-1 h-8 w-full rounded-[10px] border border-line-interactive/70 bg-raised/40 px-2 text-[13px] outline-none focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]"
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
                    className="flex w-full items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left text-faint hover:bg-raised hover:text-ink"
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
                    className="flex w-full items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-left hover:bg-raised"
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
                    <span className="font-mono text-[11px] text-faint">{option.key}</span>
                  </button>
                ))}
                {query.trim() && !exact ? (
                  <button
                    type="button"
                    disabled={create.isPending}
                    className="flex w-full items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left text-accent hover:bg-raised disabled:opacity-50"
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
    <div className="flex max-w-[28rem] flex-wrap items-center gap-1.5">
      {options.length === 0 ? (
        <p className="py-1 text-[length:var(--text-small)] text-muted">
          No options yet; add them in the schema.
        </p>
      ) : (
        options.map((option) => {
          const checked = selected.includes(option.key);
          return (
            <label
              key={option.key}
              className={cn(
                "inline-flex min-h-[var(--control-standard)] cursor-pointer items-center gap-1.5 rounded-field border px-2.5 text-[length:var(--text-small)] transition-colors pointer-coarse:min-h-[var(--control-coarse)]",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                checked
                  ? "border-accent bg-accent-wash text-accent-on-wash"
                  : "border-line-interactive text-ink hover:border-line-strong hover:bg-raised",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => {
                  const next = checked
                    ? selected.filter((key) => key !== option.key)
                    : [...selected, option.key];
                  onChange(next.length === 0 ? null : next);
                }}
              />
              {checked ? <Check aria-hidden size={12} /> : null}
              <span>{option.name}</span>
            </label>
          );
        })
      )}
    </div>
  );
}

/**
 * Single and multi relations read first: the current targets are chips, and the
 * search list opens only when the user asks for it, so mounting a record does
 * not fetch (or render) up to 500 targets.
 */
function RelationField({ spaceId, property, value, label, onChange }: PropertyFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { choices, loading } = useRelationChoices(spaceId, property, open);
  const types = useTypes(spaceId);
  const handedness = useThumbHandedness();
  const multi = property.multi === true;
  const selected = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];
  const needle = query.trim().toLowerCase();
  const visible = choices.filter((choice) => choice.title.toLowerCase().includes(needle));
  const known = new Set(choices.map((choice) => choice.id));
  // A target can only be called missing once the list it would be in is read.
  const absent = open && !loading ? selected.filter((id) => !known.has(id)) : [];
  const choiceType = new Map(choices.map((choice) => [choice.id, choice.type]));
  const choiceTitle = new Map(choices.map((choice) => [choice.id, choice.title]));
  const chips = relationChips(selected, label)
    .map((chip) => ({ ...chip, title: choiceTitle.get(chip.id) ?? chip.title }))
    .filter((chip) => !absent.includes(chip.id));

  function close() {
    setOpen(false);
    setQuery("");
  }

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
      close();
      return;
    }
    const next = selected.includes(id)
      ? selected.filter((item) => item !== id)
      : [...selected, id];
    onChange(next.length === 0 ? null : next);
  }

  return (
    <div className="grid max-w-[30rem] gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {chips.length > 0 ? (
          <ul aria-label={`${property.name} targets`} className="flex flex-wrap items-center gap-1">
            {chips.map((chip) => {
              const type = property.target_type ? undefined : choiceType.get(chip.id);
              return (
                <li
                  key={chip.id}
                  className="flex max-w-full items-center gap-1 rounded-[10px] border border-line-interactive/70 bg-raised/40 py-0.5 pl-2.5 pr-0.5 text-[length:var(--text-small)]"
                >
                  <span className="min-w-0 truncate">{chip.title}</span>
                  {type ? (
                    <span className="shrink-0 text-[11px] text-faint">
                      {typeLabel(types.data, type)}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Remove ${chip.title}`}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-faint hover:bg-surface hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
                    onClick={() => remove(chip.id)}
                  >
                    <X aria-hidden size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {open ? null : (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink pointer-coarse:min-h-11"
            onClick={() => setOpen(true)}
          >
            <Plus aria-hidden size={13} />
            {selected.length === 0 ? "Add relation" : multi ? "Add another" : "Change relation"}
          </button>
        )}
      </div>
      {open ? (
        <div
          className="grid gap-1 rounded-[10px] border border-line-interactive/70 bg-raised/40 p-2"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <input
            autoFocus
            aria-label={`Filter ${property.name} targets`}
            className="h-8 w-full rounded-[10px] border border-line-interactive/70 bg-raised/40 px-2 text-[13px] outline-none focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]"
            placeholder={multi ? "Filter targets" : "Search targets"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {absent.length > 0 ? (
            <ul aria-label="Missing targets" className="grid gap-0.5 border-b rule pb-1">
              {absent.map((id) => (
                <li key={id} className="px-1 py-0.5 text-[12px]">
                  <ThumbRow className="w-full items-center justify-between gap-2">
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
                  </ThumbRow>
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
                      "flex w-full items-baseline justify-between gap-2 rounded-[8px] px-1 py-1.5 text-left text-[13px] hover:bg-raised pointer-coarse:min-h-11",
                      picked && "text-accent",
                    )}
                    onClick={() => toggle(choice.id)}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      {picked ? <Check aria-hidden size={12} /> : null}
                      <span className="truncate">{choice.title}</span>
                    </span>
                    {property.target_type ? null : (
                      <span className="shrink-0 font-mono text-[11px] text-faint">
                        {typeLabel(types.data, choice.type)}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          <div
            className={cn(
              "flex border-t rule pt-1",
              handedness === "left" ? "justify-start" : "justify-end",
            )}
          >
            <button
              type="button"
              className="text-[12px] text-muted hover:text-ink pointer-coarse:min-h-11 pointer-coarse:text-[13px]"
              onClick={close}
            >
              {multi ? "Done" : "Cancel"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
