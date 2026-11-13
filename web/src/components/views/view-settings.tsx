import { Check } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useDeleteView, useSetDefaultView, useUpdateView } from "@/api/queries";
import type { PropertyDef, SummaryKind, TypeDef, ViewDef } from "@/api/types";
import { ThumbRow } from "@/components/handedness";
import { Button, FormError, SelectField, TextField } from "@/components/ui/controls";
import { summaryChoices, summaryFixedLabel } from "@/lib/aggregate";
import { readError } from "@/lib/display";
import { TITLE_COLUMN_KEY } from "@/lib/grid";
import { keyFromName } from "@/lib/schema";
import { footerHiddenWith, footerSummaryWith, isCoverFormat } from "@/lib/views";

interface ViewSettingsProps {
  spaceId: string;
  type: TypeDef;
  view: ViewDef;
  properties: PropertyDef[];
  onClose: () => void;
  onDeleted: (nextViewKey: string) => void;
}

/** One block of the panel: a heading, a sentence of context, the control. */
function Block({
  title,
  blurb,
  action,
  children,
}: {
  title?: string;
  blurb?: string;
  /** The block's state or its one action, on the heading's line. */
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="grid gap-2 border-t rule pt-4 first:border-t-0 first:pt-0">
      {title ? (
        <ThumbRow className="items-start gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="text-[13px] font-medium text-ink">{title}</h4>
            {blurb ? (
              <p className="mt-0.5 text-[12px] leading-[1.5] text-muted">{blurb}</p>
            ) : null}
          </div>
          {action ?? null}
        </ThumbRow>
      ) : null}
      {children}
    </section>
  );
}

/**
 * The General panel of the one View sheet: the view's name, its default, the
 * summary band and its deletion. Every write lands as it is made, so there is
 * no Save; the sheet's footer says so once.
 */
export function ViewSettings({
  spaceId,
  type,
  view,
  properties,
  onClose,
  onDeleted,
}: ViewSettingsProps) {
  const update = useUpdateView(spaceId, type.key, view.key);
  const remove = useDeleteView(spaceId, type.key);
  const makeDefault = useSetDefaultView(spaceId, type.key);
  const [name, setName] = useState(view.name);
  const [confirming, setConfirming] = useState(false);

  const isDefault = view.key === type.default_view;
  const canDelete = type.views.length > 1;
  const nameDirty = name.trim() !== view.name && name.trim() !== "";
  const selectProperties = properties.filter((property) => property.format === "select");
  const dateProperties = properties.filter((property) => property.format === "date");
  const coverProperties = properties.filter((property) => isCoverFormat(property.format));
  const groupMissing =
    view.kind === "board" &&
    view.group_by !== undefined &&
    !properties.some((property) => property.key === view.group_by);
  const dateMissing =
    view.kind === "calendar" &&
    view.date_property !== undefined &&
    !properties.some((property) => property.key === view.date_property);
  const coverProperty = properties.find((property) => property.key === view.cover);
  const coverMissing =
    view.kind === "gallery" &&
    view.cover !== undefined &&
    (coverProperty === undefined || !isCoverFormat(coverProperty.format));

  useEffect(() => {
    setName(view.name);
    setConfirming(false);
  }, [view.key, view.name]);

  // Every shown column can be summarised; the denylist is what turns one off.
  // A column whose property is gone has no cell to write, so it is left out.
  const summarisedColumns = view.columns.flatMap((key) => {
    const title = key === TITLE_COLUMN_KEY;
    const property = title
      ? undefined
      : properties.find((entry) => entry.key === key);
    if (!title && property === undefined) {
      return [];
    }
    return [
      {
        key,
        label: property?.name ?? "Title",
        choices: summaryChoices(property?.format, title),
        fixed: summaryFixedLabel(property?.format, title),
      },
    ];
  });
  const hiddenSummaries = view.footer_hidden ?? [];

  function rename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameDirty) {
      return;
    }
    update.mutate({ name: name.trim() });
  }

  function destroy() {
    remove.mutate(view.key, {
      onSuccess: (detail) => {
        onDeleted(detail.default_view);
        onClose();
      },
    });
  }

  return (
    <section aria-label="View details" className="grid gap-4">
      <Block>
        <form onSubmit={rename} aria-label="Rename view">
          <ThumbRow className="items-end gap-2">
            <div className="min-w-0 flex-1">
              <TextField
                label="Name"
                name={`${type.key}-${view.key}-name`}
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              {view.key !== keyFromName(view.name) ? (
                <p className="mt-1 font-mono text-[11px] text-faint">Key: {view.key}</p>
              ) : null}
            </div>
            <Button
              type="submit"
              variant="ghost"
              className="min-h-10 shrink-0 px-3 text-[13px] pointer-coarse:min-h-11"
              disabled={!nameDirty || update.isPending}
            >
              {update.isPending ? "Renaming…" : "Rename"}
            </Button>
          </ThumbRow>
        </form>
      </Block>

      <Block
        title="Default view"
        blurb="The view this type opens on."
        action={
          isDefault ? (
            <span className="label flex shrink-0 items-center gap-1 text-accent">
              <Check aria-hidden size={12} />
              Default
            </span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="shrink-0 min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
              disabled={makeDefault.isPending}
              onClick={() => makeDefault.mutate(view.key)}
            >
              {makeDefault.isPending ? "Making default…" : "Make default"}
            </Button>
          )
        }
      />

      {view.kind === "table" ? (
        <Block>
          <label className="flex cursor-pointer items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">Summary band</span>
              <span className="mt-0.5 block text-[12px] leading-[1.5] text-muted">
                A row under the records that totals each column. Each view chooses its
                own measure; the number&apos;s currency and decimals come from the
                property.
              </span>
            </span>
            <input
              type="checkbox"
              checked={view.footer !== false}
              disabled={update.isPending}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)] pointer-coarse:h-5 pointer-coarse:w-5"
              onChange={(event) =>
                update.mutate({ footer: event.target.checked ? null : false })
              }
            />
          </label>

          {view.footer !== false ? (
            <div className="mt-1 border-l border-line pl-3">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-1">
                <span className="label">Column</span>
                <span className="label text-right">Summary</span>
              </div>
              <ul>
                {summarisedColumns.map((column) => {
                  const off = hiddenSummaries.includes(column.key);
                  return (
                    <li
                      key={column.key}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b rule py-1 last:border-b-0"
                    >
                      <label className="flex min-h-8 min-w-0 items-center gap-2 text-[13px] text-ink pointer-coarse:min-h-11">
                        <input
                          type="checkbox"
                          aria-label={`Summarise ${column.label}`}
                          checked={!off}
                          disabled={update.isPending}
                          className="h-4 w-4 shrink-0 accent-[var(--color-accent)] pointer-coarse:h-5 pointer-coarse:w-5"
                          onChange={(event) => {
                            update.mutate({
                              footer_hidden: footerHiddenWith(
                                view,
                                column.key,
                                event.target.checked,
                              ),
                            });
                          }}
                        />
                        <span className="truncate">{column.label}</span>
                      </label>
                      {column.choices.length > 1 ? (
                        <select
                          aria-label={`Summary for ${column.label}`}
                          value={view.footer_summary?.[column.key] ?? ""}
                          disabled={update.isPending || off}
                          className="h-8 shrink-0 rounded-[10px] border border-line-interactive/70 bg-raised/40 px-2 text-[12px] text-ink transition-colors hover:border-line-strong focus:border-accent disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:text-[14px]"
                          onChange={(event) => {
                            update.mutate({
                              footer_summary: footerSummaryWith(
                                view,
                                column.key,
                                event.target.value as SummaryKind,
                              ),
                            });
                          }}
                        >
                          {column.choices.map((choice) => (
                            <option key={choice.value} value={choice.value}>
                              {choice.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="pr-2 font-mono text-[11px] text-faint">
                          {column.fixed ?? column.choices[0]?.label ?? "—"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-[12px] leading-[1.5] text-muted">
                A column you leave off keeps its place and reads blank in the band.
              </p>
            </div>
          ) : null}
        </Block>
      ) : null}

      {view.kind === "board" ? (
        <Block
          title="Board columns"
          blurb="Each option of this property becomes one column of the board."
        >
          <SelectField
            label="Group by"
            value={view.group_by ?? ""}
            options={[
              { value: "", label: "Choose a select property" },
              ...selectProperties.map((property) => ({
                value: property.key,
                label: property.name,
              })),
            ]}
            onValueChange={(next) => {
              if (next) {
                update.mutate({ group_by: next });
              }
            }}
            disabled={update.isPending}
            hint={
              selectProperties.length === 0
                ? "Add a select property in the schema first."
                : undefined
            }
          />
          {groupMissing ? (
            <p className="border-l border-warning pl-3 text-[12px] text-warning">
              The saved group property <span className="font-mono">{view.group_by}</span>{" "}
              no longer exists. Choose another one here.
            </p>
          ) : null}
        </Block>
      ) : null}

      {view.kind === "gallery" ? (
        <Block
          title="Gallery covers"
          blurb="The picture or tint each tile leads with; without one, the tile shows the type's icon."
        >
          <SelectField
            label="Cover property"
            value={view.cover ?? ""}
            options={[
              { value: "", label: "No cover (type icon)" },
              ...coverProperties.map((property) => ({
                value: property.key,
                label: property.name,
              })),
            ]}
            onValueChange={(next) => update.mutate({ cover: next || null })}
            disabled={update.isPending}
            hint={
              coverProperties.length === 0
                ? "Add an image, attachment or select property in the schema first."
                : undefined
            }
          />
          {coverMissing ? (
            <p className="border-l border-warning pl-3 text-[12px] text-warning">
              The saved cover property <span className="font-mono">{view.cover}</span>{" "}
              {coverProperty === undefined
                ? "no longer exists."
                : "cannot be a cover."}{" "}
              Choose another one here.
            </p>
          ) : null}
        </Block>
      ) : null}

      {view.kind === "calendar" ? (
        <Block
          title="Calendar dates"
          blurb="The date property that places a record on a day."
        >
          <SelectField
            label="Date property"
            value={view.date_property ?? ""}
            options={[
              { value: "", label: "Choose a date property" },
              ...dateProperties.map((property) => ({
                value: property.key,
                label: property.name,
              })),
            ]}
            onValueChange={(next) => {
              if (next) {
                update.mutate({ date_property: next });
              }
            }}
            disabled={update.isPending}
            hint={
              dateProperties.length === 0
                ? "Add a date property in the schema first."
                : undefined
            }
          />
          {dateMissing ? (
            <p className="border-l border-warning pl-3 text-[12px] text-warning">
              The saved date property{" "}
              <span className="font-mono">{view.date_property}</span> no longer exists.
              Choose another one here.
            </p>
          ) : null}
        </Block>
      ) : null}

      <Block>
        <div className="grid gap-2">
          <div>
            <h4 className="text-[13px] font-medium text-ink">Delete view</h4>
            <p className="mt-0.5 text-[12px] leading-[1.5] text-muted">
              {canDelete
                ? "The view goes; the records it showed stay where they are."
                : "A type needs at least one view. Create another before deleting this one."}
            </p>
          </div>
          {!canDelete ? null : confirming ? (
            <div className="grid gap-2">
              <p className="text-[13px] text-ink">
                Delete “{view.name}”? This cannot be undone.
              </p>
              <ThumbRow className="flex-wrap items-center gap-3 lg:justify-start">
                <Button
                  type="button"
                  variant="destructive"
                  className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
                  disabled={remove.isPending}
                  onClick={destroy}
                >
                  {remove.isPending ? "Deleting…" : "Delete view"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
                  onClick={() => setConfirming(false)}
                >
                  Keep view
                </Button>
              </ThumbRow>
            </div>
          ) : (
            <Button
              type="button"
              variant="destructive"
              className="w-fit min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
              onClick={() => setConfirming(true)}
            >
              Delete view
            </Button>
          )}
        </div>
      </Block>

      <FormError
        message={
          update.error
            ? readError(update.error)
            : makeDefault.error
              ? readError(makeDefault.error)
              : remove.error
                ? readError(remove.error)
                : null
        }
      />
    </section>
  );
}
