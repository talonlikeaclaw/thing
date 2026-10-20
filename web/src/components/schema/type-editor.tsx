import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useUpdateType } from "@/api/queries";
import type { PropertyDef, TypeDef, TypeProperty, ViewDef } from "@/api/types";
import { SmallButton } from "@/components/schema/small-button";
import { Button, FormError, SelectField, TextAreaField, TextField } from "@/components/ui/controls";
import { readError } from "@/lib/display";
import {
  addProperty,
  formatLabel,
  moveColumn,
  moveProperty,
  removeProperty,
  sameJson,
  setColumn,
  TITLE_COLUMN,
} from "@/lib/schema";

interface TypeEditorProps {
  spaceId: string;
  type: TypeDef;
  properties: PropertyDef[];
  canEdit: boolean;
}

export function TypeEditor({ spaceId, type, properties, canEdit }: TypeEditorProps) {
  const update = useUpdateType(spaceId, type.key);
  const [name, setName] = useState(type.name);
  const [plural, setPlural] = useState(type.name_plural);
  const [icon, setIcon] = useState(type.icon ?? "");
  const [description, setDescription] = useState(type.description);
  const [members, setMembers] = useState<TypeProperty[]>(type.properties);
  const [columns, setColumns] = useState<string[]>(type.view.columns);
  const [pendingKey, setPendingKey] = useState("");

  // Adopt the saved definition, including any trimming the server applied.
  useEffect(() => {
    if (update.data) {
      setName(update.data.name);
      setPlural(update.data.name_plural);
      setIcon(update.data.icon ?? "");
      setDescription(update.data.description);
      setMembers(update.data.properties);
      setColumns(update.data.view.columns);
    }
  }, [update.data]);

  const available = properties.filter(
    (property) => !members.some((member) => member.key === property.key),
  );
  const addKey = available.some((property) => property.key === pendingKey)
    ? pendingKey
    : (available[0]?.key ?? "");
  const view: ViewDef = { ...type.view, columns };
  const payload = {
    name: name.trim(),
    name_plural: plural.trim(),
    icon: icon.trim() ? icon.trim() : null,
    description,
    properties: members,
    view,
  };
  const initial = {
    name: type.name,
    name_plural: type.name_plural,
    icon: type.icon ?? null,
    description: type.description,
    properties: type.properties,
    view: type.view,
  };
  const dirty = !sameJson(payload, initial);
  const invalid = !payload.name || !payload.name_plural;

  function onAdd() {
    if (!addKey) {
      return;
    }
    setMembers(addProperty(members, addKey));
    setColumns(setColumn(columns, addKey, true));
    setPendingKey("");
  }

  function onRemove(key: string) {
    setMembers(removeProperty(members, key));
    setColumns(setColumn(columns, key, false));
  }

  function onSave() {
    update.mutate(payload);
  }

  const titleProperty = (key: string) =>
    properties.find((property) => property.key === key)?.name ?? key;
  const formatOf = (key: string) => {
    const format = properties.find((property) => property.key === key)?.format;
    return format ? formatLabel(format) : "unknown";
  };

  return (
    <section aria-labelledby="type-editor" className="settle">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b rule pb-2">
        <h2 id="type-editor" className="text-[17px] font-medium">
          {type.name}
        </h2>
        <span className="font-mono text-[11px] text-faint">types/{type.key}.yml</span>
      </div>

      <div className="mt-4 grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)]">
          <TextField
            label="Icon"
            name={`type-${type.key}-icon`}
            maxLength={8}
            placeholder="Optional"
            value={icon}
            disabled={!canEdit}
            onChange={(event) => setIcon(event.target.value)}
          />
          <TextField
            label="Name"
            name={`type-${type.key}-name`}
            required
            maxLength={200}
            value={name}
            disabled={!canEdit}
            onChange={(event) => setName(event.target.value)}
          />
          <TextField
            label="Plural"
            name={`type-${type.key}-plural`}
            required
            maxLength={200}
            value={plural}
            disabled={!canEdit}
            onChange={(event) => setPlural(event.target.value)}
          />
        </div>
        <TextAreaField
          label="Description"
          name={`type-${type.key}-description`}
          rows={2}
          maxLength={500}
          value={description}
          disabled={!canEdit}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="mt-8">
        <div className="flex items-baseline justify-between border-b rule pb-2">
          <h3 className="text-[15px] font-medium">Properties</h3>
          <span className="label tnum">{members.length}</span>
        </div>
        {members.length === 0 ? (
          <p className="border-b rule py-3 text-[13px] text-muted">
            This type has no properties yet. Add one below.
          </p>
        ) : (
          <ul>
            {members.map((member, index) => (
              <li
                key={member.key}
                className="flex flex-wrap items-center justify-between gap-2 border-b rule py-2"
              >
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="font-mono text-[11px] text-faint">{member.key}</span>
                  <span className="truncate text-[15px]">{titleProperty(member.key)}</span>
                  <span className="label">{formatOf(member.key)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <label className="label mr-2 flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={columns.includes(member.key)}
                      disabled={!canEdit}
                      onChange={(event) =>
                        setColumns(setColumn(columns, member.key, event.target.checked))
                      }
                    />
                    Column
                  </label>
                  <SmallButton
                    label={`Move ${member.key} up`}
                    disabled={!canEdit || index === 0}
                    onClick={() => setMembers(moveProperty(members, member.key, -1))}
                  >
                    <ChevronUp aria-hidden size={15} />
                  </SmallButton>
                  <SmallButton
                    label={`Move ${member.key} down`}
                    disabled={!canEdit || index === members.length - 1}
                    onClick={() => setMembers(moveProperty(members, member.key, 1))}
                  >
                    <ChevronDown aria-hidden size={15} />
                  </SmallButton>
                  <SmallButton
                    label={`Remove ${member.key}`}
                    disabled={!canEdit}
                    onClick={() => onRemove(member.key)}
                  >
                    <X aria-hidden size={15} />
                  </SmallButton>
                </div>
              </li>
            ))}
          </ul>
        )}

        {canEdit && available.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1">
              <SelectField
                label="Add a property"
                value={addKey}
                options={available.map((property) => ({
                  value: property.key,
                  label: `${property.name} (${formatLabel(property.format)})`,
                }))}
                onValueChange={setPendingKey}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              className="min-h-9 px-3 text-[13px]"
              onClick={onAdd}
            >
              <Plus aria-hidden size={15} />
              Add property
            </Button>
          </div>
        ) : null}
        {properties.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">
            No properties exist in this space yet. Create one below, then add it here.
          </p>
        ) : available.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">
            Every property in the space is already on this type.
          </p>
        ) : null}
      </div>

      <div className="mt-8">
        <div className="flex items-baseline justify-between border-b rule pb-2">
          <h3 className="text-[15px] font-medium">View columns</h3>
          <span className="label tnum">{columns.length}</span>
        </div>
        <ul>
          <li className="flex items-center justify-between border-b rule py-2">
            <span className="flex items-baseline gap-2">
              <span className="font-mono text-[11px] text-faint">{TITLE_COLUMN}</span>
              <span className="text-[15px]">Title</span>
            </span>
            <span className="label">fixed first</span>
          </li>
          {columns
            .filter((column) => column !== TITLE_COLUMN)
            .map((column) => (
              <li
                key={column}
                className="flex items-center justify-between border-b rule py-2"
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="font-mono text-[11px] text-faint">{column}</span>
                  <span className="truncate text-[15px]">{titleProperty(column)}</span>
                </span>
                <div className="flex items-center gap-1">
                  <SmallButton
                    label={`Move ${column} left`}
                    disabled={
                      !canEdit || columns.indexOf(column) <= 1
                    }
                    onClick={() => setColumns(moveColumn(columns, column, -1))}
                  >
                    <ChevronUp aria-hidden size={15} />
                  </SmallButton>
                  <SmallButton
                    label={`Move ${column} right`}
                    disabled={
                      !canEdit || columns.indexOf(column) === columns.length - 1
                    }
                    onClick={() => setColumns(moveColumn(columns, column, 1))}
                  >
                    <ChevronDown aria-hidden size={15} />
                  </SmallButton>
                  <SmallButton
                    label={`Hide ${column}`}
                    disabled={!canEdit}
                    onClick={() => setColumns(setColumn(columns, column, false))}
                  >
                    <X aria-hidden size={15} />
                  </SmallButton>
                </div>
              </li>
            ))}
        </ul>
      </div>

      {canEdit ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            className="min-h-9 px-3 text-[13px]"
            disabled={!dirty || invalid || update.isPending}
            onClick={onSave}
          >
            {update.isPending ? "Saving…" : "Save type"}
          </Button>
          {update.isSuccess && !dirty ? (
            <span className="label text-accent">Saved</span>
          ) : null}
          <div className="min-w-[12rem] flex-1">
            <FormError message={update.error ? readError(update.error) : null} />
          </div>
        </div>
      ) : (
        <p className="mt-5 text-[13px] text-muted">
          Viewers can read the schema but not change it.
        </p>
      )}
    </section>
  );
}
