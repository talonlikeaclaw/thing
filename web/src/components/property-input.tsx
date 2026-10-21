import { Check, X } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";

import { useRelationChoices, useUpdateProperty } from "@/api/queries";
import type { PropertyDef } from "@/api/types";
import { RecurrenceInput } from "@/components/recurrence-input";
import { Button } from "@/components/ui/controls";
import { readError } from "@/lib/display";
import {
  datetimeLocal,
  fromDatetimeLocal,
  inputText,
  parseCalendarDate,
  valueLabel,
} from "@/lib/format";
import { recurrenceSummary } from "@/lib/schedule";
import { optionDrafts, optionInputs } from "@/lib/schema";
import { cn } from "@/lib/cn";

interface PropertyInputProps {
  spaceId: string;
  property: PropertyDef;
  value: unknown;
  /** The raw value to write (`null` clears the key) and the label it shows. */
  onCommit: (value: unknown, label: string) => void;
  onCancel: () => void;
}

const field =
  "h-8 w-full rounded-[4px] border border-accent bg-ground px-2 text-[13px] text-ink outline-none focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]";

/** The input one cell opens, chosen by the property's format. */
export function PropertyInput(props: PropertyInputProps) {
  switch (props.property.format) {
    case "checkbox":
      return <CheckboxInput {...props} />;
    case "select":
      return <SelectInput {...props} />;
    case "multi_select":
      return <MultiSelectInput {...props} />;
    case "relation":
      return <RelationInput {...props} />;
    case "recurrence":
      return (
        <RecurrenceInput
          value={props.value}
          autoFocus
          onApply={(next) =>
            props.onCommit(next, next === null ? "" : recurrenceSummary(next))
          }
          onCancel={props.onCancel}
        />
      );
    default:
      return <TextInput {...props} />;
  }
}

function TextInput({ property, value, onCommit, onCancel }: PropertyInputProps) {
  const format = property.format;
  const initial =
    format === "datetime"
      ? datetimeLocal(value)
      : format === "date"
        ? inputText(value)
        : inputText(value);
  const [text, setText] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const settled = useRef(false);

  function commit() {
    if (settled.current) {
      return;
    }
    const raw =
      format === "date"
        ? text.trim() === ""
          ? null
          : parseCalendarDate(text.trim())
        : format === "datetime"
          ? fromDatetimeLocal(text)
          : format === "number"
            ? text.trim() === ""
              ? null
              : Number.isFinite(Number(text.trim()))
                ? Number(text.trim())
                : undefined
            : text.trim() === ""
              ? null
              : text;
    if (raw === undefined) {
      setInvalid(true);
      return;
    }
    settled.current = true;
    onCommit(raw, valueLabel(format, raw, property));
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
    <input
      autoFocus
      aria-label={property.name}
      aria-invalid={invalid || undefined}
      className={cn(field, invalid && "border-danger")}
      type={type}
      step={format === "number" ? "any" : undefined}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        setInvalid(false);
      }}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          settled.current = true;
          onCancel();
        }
      }}
    />
  );
}

function CheckboxInput({ property, value, onCommit, onCancel }: PropertyInputProps) {
  const next = value !== true;
  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        role="checkbox"
        aria-checked={next}
        aria-label={property.name}
        autoFocus
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-[3px] border transition-colors",
          next ? "border-accent bg-accent text-accent-ink" : "border-line-strong text-transparent",
        )}
        onClick={() => onCommit(next, String(next))}
      >
        <Check aria-hidden size={12} />
      </button>
      <button
        type="button"
        className="text-[11px] text-faint hover:text-ink"
        onClick={onCancel}
      >
        Cancel
      </button>
    </span>
  );
}

interface OptionChoice {
  key: string;
  name: string;
}

function matchingOptions(property: PropertyDef, query: string): OptionChoice[] {
  const options = (property.options ?? []).map(({ key, name }) => ({ key, name }));
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return options;
  }
  return options.filter(
    (option) =>
      option.name.toLowerCase().includes(needle) || option.key.toLowerCase().includes(needle),
  );
}

function SelectInput({ spaceId, property, value, onCommit, onCancel }: PropertyInputProps) {
  const [query, setQuery] = useState("");
  const create = useUpdateProperty(spaceId, property.key);
  const options = matchingOptions(property, query);
  const exact = (property.options ?? []).some(
    (option) => option.name.toLowerCase() === query.trim().toLowerCase(),
  );

  function createOption(name: string) {
    create.mutate(
      {
        options: [
          ...optionInputs(optionDrafts(property.options)),
          { name: name.trim() },
        ],
      },
      {
        onSuccess: (saved) => {
          const created = saved.options?.find((option) => option.name === name.trim());
          if (created) {
            onCommit(created.key, created.name);
          }
        },
      },
    );
  }

  return (
    <div
      className="relative min-w-[11rem]"
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) {
          onCancel();
        }
      }}
    >
      <input
        autoFocus
        aria-label={property.name}
        className={field}
        placeholder={value ? valueLabel("select", value, property) : "Choose or type"}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const match =
              options.find(
                (option) => option.name.toLowerCase() === query.trim().toLowerCase(),
              ) ?? options[0];
            if (match) {
              onCommit(match.key, match.name);
            } else if (query.trim()) {
              createOption(query);
            }
          }
        }}
      />
      <div className="absolute top-full left-0 z-30 mt-1 max-h-56 w-full min-w-[13rem] overflow-auto rounded-field border border-line bg-surface p-1 text-[13px] shadow-none">
        {value !== null && value !== undefined ? (
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-[3px] px-2 py-1.5 text-left text-faint hover:bg-raised hover:text-ink"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onCommit(null, "")}
          >
            <X aria-hidden size={12} />
            Clear
          </button>
        ) : null}
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            className="flex w-full items-baseline justify-between gap-2 rounded-[3px] px-2 py-1.5 text-left hover:bg-raised"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onCommit(option.key, option.name)}
          >
            <span>{option.name}</span>
            <span className="font-mono text-[10px] text-faint">{option.key}</span>
          </button>
        ))}
        {query.trim() && !exact ? (
          <button
            type="button"
            disabled={create.isPending}
            className="flex w-full items-center gap-1.5 rounded-[3px] px-2 py-1.5 text-left text-accent hover:bg-raised disabled:opacity-50"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => createOption(query)}
          >
            <Check aria-hidden size={12} />
            {create.isPending ? "Creating…" : `Create “${query.trim()}”`}
          </button>
        ) : null}
        {create.error ? (
          <p role="alert" className="px-2 py-1 text-[12px] text-danger">
            {readError(create.error)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function MultiSelectInput({ property, value, onCommit, onCancel }: PropertyInputProps) {
  const initial = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const [selected, setSelected] = useState<string[]>(initial);

  function toggle(key: string) {
    setSelected((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  return (
    <div className="grid min-w-[12rem] gap-1 rounded-field border border-accent bg-ground p-2">
      <div className="max-h-52 overflow-auto">
        {(property.options ?? []).length === 0 ? (
          <p className="text-[12px] text-muted">No options yet; add them in the schema.</p>
        ) : (
          (property.options ?? []).map((option) => (
            <label
              key={option.key}
              className="flex cursor-pointer items-center gap-2 rounded-[3px] px-1 py-1 text-[13px] hover:bg-raised pointer-coarse:min-h-11"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.key)}
                onChange={() => toggle(option.key)}
              />
              {option.name}
            </label>
          ))
        )}
      </div>
      <div className="flex items-center gap-1.5 border-t rule pt-1.5">
        <Button
          type="button"
          className="min-h-7 px-2 text-[12px] pointer-coarse:min-h-11"
          onClick={() => {
            const label = selected
              .map((key) => property.options?.find((option) => option.key === key)?.name ?? key)
              .join(", ");
            onCommit(selected.length === 0 ? null : selected, label);
          }}
        >
          Apply
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-7 px-2 text-[12px] pointer-coarse:min-h-11"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function RelationInput({ spaceId, property, value, onCommit, onCancel }: PropertyInputProps) {
  const { choices, loading } = useRelationChoices(spaceId, property, true);
  const initialIds = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];
  const [selected, setSelected] = useState<string[]>(initialIds);
  const [query, setQuery] = useState("");
  const multi = property.multi === true;
  const titles = new Map(choices.map((choice) => [choice.id, choice.title]));
  const needle = query.trim().toLowerCase();
  const visible = choices.filter((choice) => choice.title.toLowerCase().includes(needle));

  function choose(id: string) {
    if (!multi) {
      const title = titles.get(id) ?? id;
      onCommit(id, title);
      return;
    }
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  return (
    <div className="grid min-w-[13rem] gap-1 rounded-field border border-accent bg-ground p-2">
      <input
        autoFocus
        aria-label={property.name}
        className={field}
        placeholder={multi ? "Filter targets" : "Choose a target"}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="max-h-52 overflow-auto">
        {loading ? (
          <p className="px-1 py-1 text-[12px] text-muted">Reading targets…</p>
        ) : visible.length === 0 ? (
          <p className="px-1 py-1 text-[12px] text-muted">No matching records.</p>
        ) : (
          visible.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className="flex w-full items-baseline justify-between gap-2 rounded-[3px] px-1 py-1.5 text-left text-[13px] hover:bg-raised pointer-coarse:min-h-11"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(choice.id)}
            >
              <span className="flex items-center gap-1.5">
                {multi && selected.includes(choice.id) ? (
                  <Check aria-hidden size={12} className="text-accent" />
                ) : null}
                <span>{choice.title}</span>
              </span>
              <span className="font-mono text-[10px] text-faint">{choice.type}</span>
            </button>
          ))
        )}
      </div>
      {!multi && selected.length > 0 ? (
        <button
          type="button"
          className="border-t rule pt-1 text-left text-[12px] text-faint hover:text-ink"
          onClick={() => onCommit(null, "")}
        >
          Clear relation
        </button>
      ) : null}
      {multi ? (
        <div className="flex items-center gap-1.5 border-t rule pt-1.5">
          <Button
            type="button"
            className="min-h-7 px-2 text-[12px] pointer-coarse:min-h-11"
            onClick={() => {
              const label = selected.map((id) => titles.get(id) ?? id).join(", ");
              onCommit(selected.length === 0 ? null : selected, label);
            }}
          >
            Apply ({selected.length})
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-7 px-2 text-[12px] pointer-coarse:min-h-11"
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** A short text field for the title column, which is a field rather than a property. */
export function TitleInput({
  title,
  onCommit,
  onCancel,
}: {
  title: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(title);
  const settled = useRef(false);

  function commit() {
    if (settled.current) {
      return;
    }
    const trimmed = text.trim();
    if (!trimmed || trimmed === title) {
      settled.current = true;
      onCancel();
      return;
    }
    settled.current = true;
    onCommit(trimmed);
  }

  return (
    <input
      autoFocus
      aria-label="Title"
      className={field}
      maxLength={200}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          settled.current = true;
          onCancel();
        }
      }}
    />
  );
}

export function ClearButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
      onClick={onClick}
    >
      <X aria-hidden size={12} />
    </button>
  );
}
