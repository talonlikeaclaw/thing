import {
  CalendarDays,
  GalleryVerticalEnd,
  Kanban,
  Plus,
  Table2,
} from "lucide-react";
import { useState } from "react";

import { useCreateView } from "@/api/queries";
import type {
  CreateView,
  PropertyDef,
  TypeDef,
  ViewKind,
} from "@/api/types";
import {
  Button,
  FormError,
  SelectField,
  TextField,
} from "@/components/ui/controls";
import { readError } from "@/lib/display";
import { cn } from "@/lib/cn";

const KINDS: { value: ViewKind; label: string; icon: typeof Table2 }[] = [
  { value: "table", label: "Table", icon: Table2 },
  { value: "board", label: "Board", icon: Kanban },
  { value: "gallery", label: "Gallery", icon: GalleryVerticalEnd },
  { value: "calendar", label: "Calendar", icon: CalendarDays },
];

const KIND_LABELS: Record<ViewKind, string> = {
  table: "table",
  board: "board",
  gallery: "gallery",
  calendar: "calendar",
};

export function viewKindIcon(kind: ViewKind) {
  return KINDS.find((entry) => entry.value === kind)?.icon ?? Table2;
}

export function viewKindLabel(kind: ViewKind): string {
  return KIND_LABELS[kind];
}

interface ViewTabsProps {
  spaceId: string;
  type: TypeDef;
  properties: PropertyDef[];
  selectedKey: string;
  canEdit: boolean;
  onSelect: (key: string) => void;
  onCreated: (key: string) => void;
}

/** The saved-view tabs and the inline form that mints a new one. */
export function ViewTabs({
  spaceId,
  type,
  properties,
  selectedKey,
  canEdit,
  onSelect,
  onCreated,
}: ViewTabsProps) {
  const create = useCreateView(spaceId, type.key);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ViewKind>("table");
  const selectProperties = properties.filter((property) => property.format === "select");
  const dateProperties = properties.filter((property) => property.format === "date");
  const [groupBy, setGroupBy] = useState("");
  const [cover, setCover] = useState("");
  const [dateProperty, setDateProperty] = useState("");

  function start() {
    setOpen(true);
    setName("");
    setKind("table");
    setGroupBy(selectProperties[0]?.key ?? "");
    setCover("");
    setDateProperty(
      dateProperties.some((property) => property.key === "due_date")
        ? "due_date"
        : (dateProperties[0]?.key ?? ""),
    );
    create.reset();
  }

  function changeKind(next: ViewKind) {
    setKind(next);
    if (next === "board" && !groupBy) {
      setGroupBy(selectProperties[0]?.key ?? "");
    }
    if (next === "calendar" && !dateProperty) {
      setDateProperty(
        dateProperties.some((property) => property.key === "due_date")
          ? "due_date"
          : (dateProperties[0]?.key ?? ""),
      );
    }
  }

  const missingSelect = kind === "board" && selectProperties.length === 0;
  const missingDate = kind === "calendar" && dateProperties.length === 0;
  const missingGroup = kind === "board" && !groupBy;
  const missingDateProperty = kind === "calendar" && !dateProperty;
  const invalid = !name.trim() || missingSelect || missingDate || missingGroup || missingDateProperty;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invalid) {
      return;
    }
    const input: CreateView = { name: name.trim(), kind };
    if (kind === "board") {
      input.group_by = groupBy;
    }
    if (kind === "gallery" && cover) {
      input.cover = cover;
    }
    if (kind === "calendar") {
      input.date_property = dateProperty;
    }
    create.mutate(input, {
      onSuccess: (detail) => {
        const created = detail.views.at(-1);
        if (created) {
          onCreated(created.key);
        }
        setOpen(false);
      },
    });
  }

  return (
    <div className="mt-5">
      <div
        aria-label="Saved views"
        className="flex items-stretch gap-1 overflow-x-auto border-b rule"
      >
        {type.views.map((view) => {
          const Icon = viewKindIcon(view.kind);
          const selected = view.key === selectedKey;
          const isDefault = view.key === type.default_view;
          return (
            <button
              key={view.key}
              type="button"
              aria-pressed={selected}
              title={`${viewKindLabel(view.kind)} view`}
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-b border-transparent px-2.5 py-2 text-[13px] transition-colors hover:text-ink pointer-coarse:min-h-11",
                selected ? "border-accent text-accent" : "text-muted",
              )}
              onClick={() => onSelect(view.key)}
            >
              <Icon aria-hidden size={14} className="shrink-0" />
              <span className="max-w-[14rem] truncate">{view.name}</span>
              {isDefault ? (
                <span className="font-mono text-[9px] tracking-[0.09em] text-faint">
                  DEFAULT
                </span>
              ) : null}
            </button>
          );
        })}
        {canEdit ? (
          <button
            type="button"
            aria-expanded={open}
            className="label flex shrink-0 items-center gap-1 px-2.5 py-2 text-faint transition-colors hover:text-accent pointer-coarse:min-h-11"
            onClick={() => (open ? setOpen(false) : start())}
          >
            <Plus aria-hidden size={13} />
            New view
          </button>
        ) : null}
      </div>

      {open && canEdit ? (
        <form
          className="mt-3 grid gap-3 border-b rule pb-4"
          onSubmit={submit}
          aria-label="New view"
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <TextField
              label="Name"
              name={`new-${type.key}-view-name`}
              required
              maxLength={80}
              placeholder="By room"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="grid gap-1.5">
              <span className="label" id={`new-${type.key}-view-kind`}>
                Kind
              </span>
              <div
                role="group"
                aria-labelledby={`new-${type.key}-view-kind`}
                className="flex flex-wrap gap-1"
              >
                {KINDS.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={kind === value}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-field border border-line-interactive px-2.5 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink aria-pressed:border-accent aria-pressed:text-accent pointer-coarse:min-h-11"
                    onClick={() => changeKind(value)}
                  >
                    <Icon aria-hidden size={14} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {kind === "board" ? (
            missingSelect ? (
              <p className="max-w-[62ch] border-l border-warning pl-3 text-[13px] text-warning">
                A board groups by a select property. Add a select property to this type
                in the schema first.
              </p>
            ) : (
              <SelectField
                label="Group by"
                value={groupBy}
                options={selectProperties.map((property) => ({
                  value: property.key,
                  label: property.name,
                }))}
                onValueChange={setGroupBy}
              />
            )
          ) : null}

          {kind === "gallery" ? (
            <SelectField
              label="Cover property"
              value={cover}
              options={[
                { value: "", label: "No cover (type icon)" },
                ...properties.map((property) => ({
                  value: property.key,
                  label: property.name,
                })),
              ]}
              onValueChange={setCover}
            />
          ) : null}

          {kind === "calendar" ? (
            missingDate ? (
              <p className="max-w-[62ch] border-l border-warning pl-3 text-[13px] text-warning">
                A calendar places records on a date property. Add a date property to this
                type in the schema first.
              </p>
            ) : (
              <SelectField
                label="Date property"
                value={dateProperty}
                options={dateProperties.map((property) => ({
                  value: property.key,
                  label: property.name,
                }))}
                onValueChange={setDateProperty}
              />
            )
          ) : null}

          <p className="max-w-[62ch] text-[12px] text-muted">
            The new view starts with the current default view's columns, filter and sort.
            The kind is fixed after creation.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              className="min-h-9 px-3 text-[13px]"
              disabled={invalid || create.isPending}
            >
              {create.isPending ? "Creating…" : "Create view"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-9 px-3 text-[13px]"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <div className="min-w-[12rem] flex-1">
              <FormError message={create.error ? readError(create.error) : null} />
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
}
