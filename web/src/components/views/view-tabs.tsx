import {
  ArrowUpDown,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  GalleryVerticalEnd,
  Kanban,
  Plus,
  Table2,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

import { useCreateView, useMoveView } from "@/api/queries";
import { ThumbRow } from "@/components/handedness";
import type {
  CreateView,
  PropertyDef,
  TypeDef,
  ViewDef,
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
import { useCompactWidth } from "@/lib/media";
import { movedViewSlot } from "@/lib/views";

/** One edge action of the view strip: a circle, 44 px on a coarse pointer. */
const EDGE_BUTTON =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent-on-wash transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] pointer-coarse:size-11";

/** One step of the reorder arrows; sized like the rail's, 44 px on coarse. */
const MOVE_BUTTON =
  "inline-flex h-8 w-8 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-faint pointer-coarse:h-11 pointer-coarse:w-11";

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
  const move = useMoveView(spaceId, type.key);
  const compact = useCompactWidth();
  const [open, setOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ViewKind>("table");
  const selectProperties = properties.filter((property) => property.format === "select");
  const dateProperties = properties.filter((property) => property.format === "date");
  const [groupBy, setGroupBy] = useState("");
  const [cover, setCover] = useState("");
  const [dateProperty, setDateProperty] = useState("");

  const keyboardNav = useRef(false);

  // A selected tab that is scrolled out of the strip must become visible, and
  // an arrow-key selection moves focus with it. Compact wraps instead of
  // scrolling, so there is nothing to bring into view there.
  useEffect(() => {
    const tab = document.getElementById(`view-tab-${selectedKey}`);
    if (!compact) {
      tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    if (keyboardNav.current) {
      keyboardNav.current = false;
      tab?.focus();
    }
  }, [selectedKey, compact]);

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

  /** Sends one view to its neighbouring slot; the ends do nothing. */
  function shift(view: ViewDef, delta: number) {
    const floor = view.key === type.default_view ? 0 : 1;
    const position = movedViewSlot(type.views, view.key, delta, floor);
    if (position !== null) {
      move.mutate({ key: view.key, position });
    }
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

  // One cluster in the middle of the strip: Reorder, the saved views, then New
  // view. Nothing pins to the outer edges, so the family reads as one control
  // at every width.
  const reorderSlot = canEdit ? (
    type.views.length > 1 ? (
      <button
        type="button"
        aria-pressed={reordering}
        aria-label={reordering ? "Finish reordering views" : "Reorder views"}
        title={reordering ? "Finish reordering views" : "Reorder views"}
        className={cn(EDGE_BUTTON, reordering && "bg-accent/25 ring-1 ring-accent/50")}
        onClick={() => {
          setOpen(false);
          setReordering((current) => !current);
        }}
      >
        {reordering ? (
          <Check aria-hidden size={15} />
        ) : (
          <ArrowUpDown aria-hidden size={15} />
        )}
      </button>
    ) : null
  ) : null;

  const newViewSlot = canEdit ? (
    reordering ? null : (
      <button
        type="button"
        aria-label="New view"
        title="New view"
        aria-expanded={open}
        className={EDGE_BUTTON}
        onClick={() => (open ? setOpen(false) : start())}
      >
        <Plus aria-hidden size={15} />
      </button>
    )
  ) : null;

  return (
    <div className="mt-4">
      <ThumbRow className="items-center justify-center gap-1.5">
        <div className="flex min-w-0 max-w-full items-center justify-center gap-1.5">
        {reorderSlot}
        <div
          role="tablist"
          aria-label="Saved views"
          className="mx-auto flex w-fit min-w-0 max-w-full flex-nowrap items-center gap-1 overflow-x-auto overscroll-x-contain rounded-full border border-line/80 bg-inset/60 p-1"
          onKeyDown={(event) => {
            const index = type.views.findIndex((view) => view.key === selectedKey);
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              keyboardNav.current = true;
              const delta = event.key === "ArrowRight" ? 1 : -1;
              const next = type.views[(index + delta + type.views.length) % type.views.length];
              if (next) {
                onSelect(next.key);
              }
            } else if (event.key === "Home" && type.views[0]) {
              event.preventDefault();
              keyboardNav.current = true;
              onSelect(type.views[0].key);
            } else if (event.key === "End") {
              const last = type.views[type.views.length - 1];
              if (last) {
                event.preventDefault();
                keyboardNav.current = true;
                onSelect(last.key);
              }
            }
          }}
        >
          {type.views.map((view, index) => {
            const Icon = viewKindIcon(view.kind);
            const selected = view.key === selectedKey;
            const isDefault = view.key === type.default_view;
            const tab = (
              <button
                id={`view-tab-${view.key}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`view-panel-${type.key}`}
                tabIndex={selected ? 0 : -1}
                title={`${viewKindLabel(view.kind)} view`}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[length:var(--text-small)] transition-colors pointer-coarse:min-h-11",
                  // One row: the strip scrolls sideways rather than wrapping a
                  // second line under the first.
                  "shrink-0",
                  selected
                    ? "bg-accent-wash text-accent-on-wash"
                    : "text-muted hover:bg-raised/60 hover:text-ink",
                )}
                onClick={() => onSelect(view.key)}
              >
                <Icon aria-hidden size={14} className="shrink-0" />
                <span className="max-w-[14rem] truncate">{view.name}</span>
                {isDefault ? (
                  <span className="font-mono text-[11px] tracking-[0.09em] text-muted">
                    DEFAULT
                  </span>
                ) : null}
              </button>
            );
            if (!reordering) {
              return <Fragment key={view.key}>{tab}</Fragment>;
            }
            // The default opens the type and sits first; only the views after
            // it can move, and 1 is the earliest slot they may take.
            const pinned = isDefault;
            return (
              <div
                key={view.key}
                role="none"
                className={cn("flex items-stretch", compact ? "w-full" : "shrink-0")}
              >
                {tab}
                <span className="flex shrink-0 items-center">
                  <button
                    type="button"
                    aria-label={`Move ${view.name} up`}
                    disabled={pinned || index <= 1 || move.isPending}
                    className={MOVE_BUTTON}
                    onClick={() => shift(view, -1)}
                  >
                    <ChevronUp aria-hidden size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${view.name} down`}
                    disabled={pinned || index === type.views.length - 1 || move.isPending}
                    className={MOVE_BUTTON}
                    onClick={() => shift(view, 1)}
                  >
                    <ChevronDown aria-hidden size={13} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        {newViewSlot}
        </div>
      </ThumbRow>

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
              autoFocus
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
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-[10px] border border-line-interactive/70 bg-raised/40 px-2.5 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink aria-pressed:border-accent aria-pressed:text-accent pointer-coarse:min-h-11"
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
              className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
              disabled={invalid || create.isPending}
            >
              {create.isPending ? "Creating…" : "Create view"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
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
