import { Dialog } from "@base-ui/react/dialog";
import { Pencil, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { useUpdateType } from "@/api/queries";
import type { PropertyDef, TypeDef, TypeProperty, ViewDef } from "@/api/types";
import { AddPropertyDialog } from "@/components/add-property";
import { ThumbRow, useThumbHandedness } from "@/components/handedness";
import { PropertyEditorSheet } from "@/components/schema/property-editor";
import { SmallButton } from "@/components/schema/small-button";
import { Button, FormError } from "@/components/ui/controls";
import { FormatChip } from "@/components/ui/page";
import { PositionMenu } from "@/components/ui/position-menu";
import {
  SheetCloseButton,
  SheetHeader,
  SheetPopup,
  SheetTitle,
  SheetViewport,
} from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";
import { foldProperty, scoreProperty } from "@/lib/property-search";
import {
  effectiveMembers,
  effectiveProperties,
  formatLabel,
  moveProperty,
  removeProperty,
} from "@/lib/schema";

interface ManagePropertiesProps {
  spaceId: string;
  type: TypeDef;
  /** The whole space library; the add sheet offers what the type does not carry. */
  library: PropertyDef[];
  canEdit: boolean;
  /** The table view an added column joins, when the opener has one. */
  view?: ViewDef;
  onClose: () => void;
}

interface MemberRow {
  member: TypeProperty;
  property: PropertyDef | undefined;
  generated: boolean;
}

/**
 * The type's property list as a sheet: search it, reorder the writable members,
 * edit one in the shared property form, remove one from this type, or add one.
 * Removing writes the member list immediately; the server's refusal names any
 * view that still depends on the property.
 */
export function ManageProperties({
  spaceId,
  type,
  library,
  canEdit,
  view,
  onClose,
}: ManagePropertiesProps) {
  const update = useUpdateType(spaceId, type.key);
  const handedness = useThumbHandedness();
  const [query, setQuery] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const definitions = useMemo(
    () => effectiveProperties(type, library),
    [type, library],
  );
  const rows = useMemo<MemberRow[]>(() => {
    const generated = new Set((type.implicit_properties ?? []).map((property) => property.key));
    return effectiveMembers(type).map((member) => ({
      member,
      property: definitions.find((property) => property.key === member.key),
      generated: generated.has(member.key),
    }));
  }, [type, definitions]);
  const needle = foldProperty(query);
  const matches =
    needle === ""
      ? rows
      : rows.filter(({ member, property }) =>
          property
            ? scoreProperty(property, needle) !== null
            : foldProperty(member.key).includes(needle),
        );
  const editing = rows.find((row) => row.member.key === editingKey)?.property;
  const writable = type.properties.length;

  function write(next: TypeProperty[], key: string) {
    setPendingKey(key);
    setError(null);
    update.mutate(
      { properties: next },
      {
        onError: (failure) => setError(readError(failure)),
        onSettled: () => setPendingKey(null),
      },
    );
  }

  function moveTo(key: string, position: number) {
    const from = type.properties.findIndex((member) => member.key === key);
    if (from === -1) {
      return;
    }
    const delta = position - 1 - from;
    if (delta === 0) {
      return;
    }
    write(moveProperty(type.properties, key, delta), key);
  }

  function remove(key: string) {
    write(removeProperty(type.properties, key), key);
  }

  return (
    <>
      <Dialog.Root
        open
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 scrim" />
          <SheetViewport>
            <SheetPopup className="sm:w-[38rem]">
              <SheetHeader
                className={cn(
                  "gap-[var(--space-3)]",
                  handedness === "left" ? "justify-start" : "justify-between",
                )}
              >
                {handedness === "left" ? (
                  <>
                    <SheetCloseButton label="Close properties" />
                    <SheetTitle className="min-w-0 flex-1 truncate">
                      Properties
                    </SheetTitle>
                  </>
                ) : (
                  <>
                    <SheetTitle className="min-w-0 flex-1 truncate">
                      Properties
                    </SheetTitle>
                    <SheetCloseButton label="Close properties" />
                  </>
                )}
              </SheetHeader>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--space-4)] py-[var(--space-3)] pb-[max(1rem,env(safe-area-inset-bottom))]">
                <div className="flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 border-b rule px-1 pb-2">
                    <Search aria-hidden size={13} className="shrink-0 text-faint" />
                    <input
                      type="search"
                      value={query}
                      aria-label="Search properties"
                      placeholder="Search properties."
                      onChange={(event) => setQuery(event.target.value)}
                      className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint pointer-coarse:h-11 pointer-coarse:text-base"
                    />
                    <span className="tnum shrink-0 font-mono text-[11px] text-faint">
                      {matches.length} of {rows.length}
                    </span>
                  </div>
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-8 shrink-0 px-2 text-[12px] pointer-coarse:min-h-11"
                      disabled={pendingKey !== null}
                      onClick={() => setAdding(true)}
                    >
                      <Plus aria-hidden size={14} />
                      Add property
                    </Button>
                  ) : null}
                </div>

                <p className="mt-2 text-[13px] text-muted">
                  {type.name} carries {rows.length}{" "}
                  {rows.length === 1 ? "property" : "properties"}. Reorder or remove a member
                  here; the definition itself stays in the space library.
                </p>

                {error ? (
                  <div className="mt-3">
                    <FormError message={error} />
                  </div>
                ) : null}

                {matches.length === 0 ? (
                  <p className="mt-4 text-[13px] text-muted">
                    {rows.length === 0
                      ? "This type has no properties yet. Add one to give its records a field."
                      : `No property matches “${query.trim()}”.`}
                  </p>
                ) : (
                  <ul className="mt-2">
                    {matches.map(({ member, property, generated }) => {
                      const name = property?.name ?? member.key;
                      const index = type.properties.findIndex(
                        (candidate) => candidate.key === member.key,
                      );
                      return (
                        <li key={member.key} className="border-b rule">
                          <ThumbRow className="items-center gap-2 py-1.5">
                            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                              <span className="truncate text-[14px] text-accent">{name}</span>
                              <span className="font-mono text-[11px] text-faint">
                                {member.key}
                              </span>
                              <FormatChip>
                                {property ? formatLabel(property.format) : "unknown"}
                              </FormatChip>
                              {generated ? <span className="label">generated</span> : null}
                            </span>
                            {generated ? null : canEdit ? (
                              <span className="flex items-center gap-1">
                                <SmallButton
                                  label={`Edit ${name}`}
                                  disabled={pendingKey !== null || property === undefined}
                                  onClick={() => setEditingKey(member.key)}
                                >
                                  <Pencil aria-hidden size={14} />
                                </SmallButton>
                                <SmallButton
                                  label={`Remove ${name} from this type`}
                                  disabled={pendingKey !== null}
                                  onClick={() => remove(member.key)}
                                >
                                  <X aria-hidden size={15} />
                                </SmallButton>
                                <PositionMenu
                                  name={name}
                                  index={index + 1}
                                  count={writable}
                                  disabled={pendingKey !== null}
                                  onMove={(position) => moveTo(member.key, position)}
                                />
                              </span>
                            ) : null}
                          </ThumbRow>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </SheetPopup>
          </SheetViewport>
        </Dialog.Portal>
      </Dialog.Root>

      {adding ? (
        <AddPropertyDialog
          spaceId={spaceId}
          type={type}
          library={library}
          view={view}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {editingKey !== null && editing ? (
        <PropertyEditorSheet
          spaceId={spaceId}
          property={editing}
          canEdit={canEdit}
          onClose={() => setEditingKey(null)}
        />
      ) : null}
    </>
  );
}
