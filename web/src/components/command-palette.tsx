import { Dialog } from "@base-ui/react/dialog";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router";

import {
  useMe,
  usePaletteRecords,
  useSpaces,
  useTrash,
  useTypes,
} from "@/api/queries";
import { useHandedness } from "@/components/handedness";
import { ThingIcon } from "@/components/thing-icon";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { readRecent, recentKey, type RecentItem } from "@/lib/recent";
import { rank } from "@/lib/search";

interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  /** A record, type or space glyph; actions carry none. */
  icon?: string;
  /** A navigation target, or a callback for actions that are not routes. */
  to?: string;
  run?: () => void;
  disabled?: boolean;
}

type SectionId = "actions" | "recent" | "records" | "types" | "spaces";

interface PaletteSection {
  id: SectionId;
  label: string;
  items: PaletteItem[];
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The space in the path, or `undefined` on the spaces list. */
  spaceId: string | undefined;
  /** Present for an owner or editor in a space; opens the capture sheet. */
  onCapture?: () => void;
}


/**
 * The global command sheet: actions, recent records, types and spaces, plus a
 * bounded title lookup. Records are fetched only while the query is non-empty;
 * M5 replaces this lookup with the real search index.
 */
export function CommandPalette({
  open,
  onOpenChange,
  spaceId,
  onCapture,
}: CommandPaletteProps) {
  const me = useMe();
  const spaces = useSpaces(open);
  const types = useTypes(spaceId);
  const trash = useTrash(spaceId);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();
  const typeList = types.data ?? [];
  const records = usePaletteRecords(
    spaceId,
    typeList.map((type) => type.key),
    open && trimmed.length > 0,
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setActive(0);
    const userId = me.data?.id;
    if (spaceId && userId) {
      setRecent(readRecent(window.localStorage, recentKey(userId, spaceId)));
    } else {
      setRecent([]);
    }
  }, [open, spaceId, me.data?.id]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const actions: PaletteItem[] = [];
  if (spaceId) {
    if (onCapture) {
      actions.push({
        id: "action:capture",
        label: "Quick capture",
        hint: "create a record",
        run: onCapture,
      });
    }
    actions.push(
      {
        id: "action:schedule",
        label: "Open Schedule",
        hint: "space",
        to: `/s/${spaceId}/agenda`,
      },
      {
        id: "action:types",
        label: "Types and properties",
        hint: "space",
        to: `/s/${spaceId}/schema`,
      },
      {
        id: "action:members",
        label: "Members",
        hint: "space",
        to: `/s/${spaceId}/members`,
      },
      {
        id: "action:trash",
        label: "Trash",
        hint: "space",
        to: `/s/${spaceId}/trash`,
      },
      {
        id: "action:settings",
        label: "Settings",
        hint: "space",
        to: `/s/${spaceId}/settings`,
      },
    );
  }
  actions.push({
    id: "action:spaces",
    label: "All spaces",
    hint: "global",
    to: "/",
  });
  if (!spaceId) {
    actions.unshift({
      id: "action:capture",
      label: "Quick capture",
      hint: "Open a space to capture a record",
      disabled: true,
    });
  }

  const trashed = new Set((trash.data ?? []).map((item) => item.id));
  const recentItems: PaletteItem[] = recent
    .filter((item) => !trashed.has(item.id))
    .map((item) => ({
      id: `recent:${item.id}`,
      label: item.title,
      hint: `${item.type} · ${relativeTime(item.at)}`,
      ...(item.icon ? { icon: item.icon } : {}),
      to: `/s/${spaceId}/o/${item.id}`,
    }));
  const typeItems: PaletteItem[] = typeList.map((type) => ({
    id: `type:${type.key}`,
    label: type.name,
    hint: `${type.key} · ${type.object_count} ${type.name_plural.toLowerCase()}`,
    ...(type.icon ? { icon: type.icon } : {}),
    to: `/s/${spaceId}/t/${type.key}`,
  }));
  const spaceItems: PaletteItem[] = (spaces.data ?? []).map((entry) => ({
    id: `space:${entry.id}`,
    label: entry.name,
    hint: entry.role,
    ...(entry.icon ? { icon: entry.icon } : {}),
    to: `/s/${entry.id}`,
  }));
  const recordItems: PaletteItem[] = records.map((record) => ({
    id: `record:${record.id}`,
    label: record.title,
    hint: `${record.type} · ${relativeTime(record.updated_at)}`,
    ...(record.icon ? { icon: record.icon } : {}),
    to: `/s/${spaceId}/o/${record.id}`,
  }));

  const sections: PaletteSection[] = [];
  if (trimmed === "") {
    sections.push({ id: "actions", label: "Actions", items: actions });
    if (recentItems.length > 0) {
      sections.push({ id: "recent", label: "Recent", items: recentItems });
    }
    if (typeItems.length > 0) {
      sections.push({ id: "types", label: "Types", items: typeItems });
    }
    if (spaceItems.length > 0) {
      sections.push({ id: "spaces", label: "Spaces", items: spaceItems });
    }
  } else {
    const rankedActions = rank(trimmed, actions, (item) => `${item.label} ${item.hint}`).slice(
      0,
      5,
    );
    const rankedRecords = rank(trimmed, recordItems, (item) => item.label).slice(0, 12);
    const rankedTypes = rank(trimmed, typeItems, (item) => `${item.label} ${item.hint}`).slice(
      0,
      5,
    );
    const rankedSpaces = rank(trimmed, spaceItems, (item) => item.label).slice(0, 5);
    if (rankedActions.length > 0) {
      sections.push({ id: "actions", label: "Actions", items: rankedActions });
    }
    if (rankedRecords.length > 0) {
      sections.push({ id: "records", label: "Records", items: rankedRecords });
    }
    if (rankedTypes.length > 0) {
      sections.push({ id: "types", label: "Types", items: rankedTypes });
    }
    if (rankedSpaces.length > 0) {
      sections.push({ id: "spaces", label: "Spaces", items: rankedSpaces });
    }
  }

  const flat = sections.flatMap((section) => section.items);
  const activeIndex = flat.length === 0 ? 0 : Math.min(active, flat.length - 1);
  const activeItem = flat[activeIndex];

  useEffect(() => {
    if (!open) {
      return;
    }
    document
      .getElementById(`palette-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, flat.length]);

  function select(item: PaletteItem) {
    if (item.disabled) {
      return;
    }
    onOpenChange(false);
    item.run?.();
    if (item.to) {
      navigate(item.to);
    }
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (flat.length > 0) {
        setActive((activeIndex + 1) % flat.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (flat.length > 0) {
        setActive((activeIndex - 1 + flat.length) % flat.length);
      }
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(flat.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeItem) {
        select(activeItem);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
    }
  }

  const { handedness } = useHandedness();
  const close = (
    <Dialog.Close
      key="close"
      aria-label="Close search"
      className={cn(
        "inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        handedness === "left" ? "-ml-1" : "-mr-1",
      )}
    >
      <X aria-hidden size={15} />
    </Dialog.Close>
  );

  let offset = 0;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-ground/85" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center sm:items-start sm:px-4 sm:pt-[12vh]">
          <Dialog.Popup className="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-sheet border border-line bg-surface sm:w-[40rem] sm:rounded-sheet">
            <Dialog.Title className="sr-only">Search and commands</Dialog.Title>
            <Dialog.Description className="sr-only">
              Search records, types, spaces and actions.
            </Dialog.Description>

            <div className="flex items-center gap-3 border-b rule px-4">
              {handedness === "left" ? close : null}
              <Search aria-hidden size={16} className="shrink-0 text-faint" />
              <input
                ref={inputRef}
                role="combobox"
                aria-expanded
                aria-haspopup="listbox"
                aria-controls="command-palette-list"
                aria-autocomplete="list"
                aria-activedescendant={
                  activeItem ? `palette-option-${activeIndex}` : undefined
                }
                aria-label="Search and commands"
                placeholder="Search records, types, spaces or actions"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKeyDown}
                className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint pointer-coarse:text-base"
              />
              <kbd className="hidden shrink-0 rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint sm:block">
                Esc
              </kbd>
              {handedness === "right" ? close : null}
            </div>

            <div
              id="command-palette-list"
              role="listbox"
              aria-label="Results"
              className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
            >
              {flat.length === 0 ? (
                <p className="px-3 py-6 text-[13px] text-muted">
                  No matches. Try a type, a record title, or an action.
                </p>
              ) : (
                sections.map((section) => {
                  const base = offset;
                  offset += section.items.length;
                  return (
                    <div key={section.id} role="group" aria-label={section.label}>
                      <p aria-hidden className="label px-3 pt-2 pb-1">
                        {section.label}
                      </p>
                      {section.items.map((item, index) => {
                        const flatIndex = base + index;
                        const selected = flatIndex === activeIndex;
                        return (
                          <div
                            key={item.id}
                            id={`palette-option-${flatIndex}`}
                            role="option"
                            aria-selected={selected}
                            aria-disabled={item.disabled || undefined}
                            className={cn(
                              "flex items-baseline gap-3 rounded-[4px] px-3 py-2 text-[14px] transition-colors pointer-coarse:min-h-11",
                              item.disabled
                                ? "cursor-default text-faint"
                                : "cursor-pointer",
                              !item.disabled && (selected ? "bg-raised text-accent" : "text-ink"),
                            )}
                            onMouseEnter={() => setActive(flatIndex)}
                            onClick={() => select(item)}
                          >
                            <span className="flex min-w-0 flex-1 items-baseline gap-2">
                              {item.icon ? (
                                <ThingIcon icon={item.icon} size="sm" />
                              ) : null}
                              <span className="min-w-0 truncate">{item.label}</span>
                            </span>
                            <span className="shrink-0 font-mono text-[11px] text-faint">
                              {item.hint}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t rule px-4 py-2 text-[11px] text-faint">
              <span className="hidden font-mono sm:inline pointer-coarse:hidden">↑↓ move · Enter open · Esc close</span>
              <span aria-live="polite" className="font-mono tnum">
                {flat.length} results
              </span>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
