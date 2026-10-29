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
import { useHandedness } from "@/components/handedness";
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

/** One step of the reorder arrows; sized like the rail's, 44 px on coarse. */
const MOVE_BUTTON =
  "inline-flex h-8 w-8 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-faint pointer-coarse:h-11 pointer-coarse:w-11";

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
  const { handedness } = useHandedness();
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

  const newViewButton = canEdit && !reordering ? (
    <button
      type="button"
      aria-label="New view"
      aria-expanded={open}
      className="label inline-flex shrink-0 items-center justify-center gap-1 px-2.5 py-2 text-faint transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:min-w-11 max-sm:min-h-11 max-sm:min-w-11"
      onClick={() => (open ? setOpen(false) : start())}
    >
      <Plus aria-hidden size={13} />
      <span>New view</span>
    </button>
  ) : null;

  // Reordering is a mode on the strip it reorders, the same way the space rail
  // hands its ordered list a Reorder toggle rather than hiding it in a panel.
  const reorderButton =
    canEdit && type.views.length > 1 ? (
      <button
        type="button"
        aria-pressed={reordering}
        aria-label={reordering ? "Finish reordering views" : "Reorder views"}
        className="label inline-flex shrink-0 items-center justify-center gap-1 px-2 py-2 text-faint transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:min-w-11 max-sm:min-h-11 max-sm:min-w-11"
        onClick={() => {
          setOpen(false);
          setReordering((current) => !current);
        }}
      >
        {reordering ? (
          <Check aria-hidden size={13} />
        ) : (
          <ArrowUpDown aria-hidden size={13} />
        )}
        <span>{reordering ? "Done" : "Reorder"}</span>
      </button>
    ) : null;

  const stripActions = (
    <span className="flex shrink-0 items-stretch gap-1">
      {reorderButton}
      {newViewButton}
    </span>
  );

  const handednessFirst = !compact && handedness === "left";

  return (
    <div className="mt-5">
      <div
        className={cn(
          "flex items-stretch gap-1 border-b rule",
          compact && "flex-wrap",
        )}
      >
        {handednessFirst ? stripActions : null}
        <div
          role="tablist"
          aria-label="Saved views"
          className={cn(
            "flex min-w-0 items-stretch gap-1",
            compact ? "flex-1 flex-wrap" : "overflow-x-auto overscroll-x-contain",
          )}
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
                tabIndex={selected ? 0 : -1}
                title={`${viewKindLabel(view.kind)} view`}
                className={cn(
                  "flex items-center gap-1.5 border-b border-transparent px-2.5 py-2 text-[13px] transition-colors hover:text-ink pointer-coarse:min-h-11",
                  // Reordering is a list, not a wrap: every view gets one full
                  // row on compact, so a long name cannot change the column count.
                  reordering && compact ? "min-w-0 flex-1" : "shrink-0",
                  selected ? "border-accent text-accent" : "text-muted",
                )}
                onClick={() => onSelect(view.key)}
              >
                <Icon aria-hidden size={14} className="shrink-0" />
                <span className="max-w-[14rem] truncate">{view.name}</span>
                {isDefault ? (
                  <span className="font-mono text-[11px] tracking-[0.09em] text-faint">
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
        {!compact && !handednessFirst ? stripActions : null}
      </div>

      {compact ? (
        // The phone strip is a two-column wrap; inline controls would take a
        // tab's width, so both actions sit in their own row under the views.
        <div
          className={cn(
            "flex items-stretch gap-1 pb-1",
            handedness === "left" ? "justify-start" : "justify-end",
          )}
        >
          {stripActions}
        </div>
      ) : null}

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
