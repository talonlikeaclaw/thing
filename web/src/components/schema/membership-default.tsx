import { useState } from "react";

import { useSpace } from "@/api/queries";
import type { PropertyDef, PropertyFormat, TypeProperty } from "@/api/types";
import { PropertyField } from "@/components/property-field";
import { valueLabel } from "@/lib/format";
import { isComputed } from "@/lib/schema";

/**
 * Whether a membership may carry a default: a calculated property stores
 * nothing to default, and a unique one would make the second create a conflict.
 */
export function defaultApplies(property: PropertyDef): boolean {
  return !isComputed(property) && property.validation?.unique !== true;
}

/**
 * Whether a default can be chosen before the property exists: a select has no
 * options, a relation no targets and a file no bytes yet, so those ask for the
 * default once the property is created. A member is pickable, because the
 * space's people exist before the column does.
 */
export function defaultPickable(format: PropertyFormat): boolean {
  return (
    format === "text" ||
    format === "number" ||
    format === "checkbox" ||
    format === "date" ||
    format === "datetime" ||
    format === "url" ||
    format === "email" ||
    format === "recurrence" ||
    format === "member"
  );
}

interface MembershipDefaultProps {
  spaceId: string;
  member: TypeProperty;
  property: PropertyDef;
  canEdit: boolean;
  /**
   * Whether a default can be chosen now. The add-property form passes `false`
   * for a format whose options or targets do not exist yet.
   */
  pickable?: boolean;
  onChange: (member: TypeProperty) => void;
  /** A half-typed default disables the form's Save, exactly as on a record. */
  onInvalid: (invalid: boolean) => void;
}

/**
 * The Required and Default controls of one membership. It is the body of the
 * **On this type** group in the property sheet and in the add-property form, so
 * both surfaces ask the same two questions the same way.
 */
export function MembershipDefault({
  spaceId,
  member,
  property,
  canEdit,
  pickable = true,
  onChange,
  onInvalid,
}: MembershipDefaultProps) {
  const space = useSpace(spaceId);
  // The record's own text field keeps its draft in local state, so clearing a
  // default has to remount it to be visible.
  const [epoch, setEpoch] = useState(0);
  const calculated = isComputed(property);
  const applies = defaultApplies(property);
  const showsDefault = applies && pickable;
  const hasDefault = member.default !== undefined && member.default !== null;

  function set(patch: Partial<TypeProperty>) {
    onChange({ ...member, ...patch });
  }

  return (
    <div className="grid gap-3">
      <label className="flex min-h-9 items-center gap-2 text-[13px] text-ink pointer-coarse:min-h-11">
        <input
          type="checkbox"
          checked={member.required}
          disabled={!canEdit || calculated}
          className="h-4 w-4 accent-[var(--color-accent)] pointer-coarse:h-5 pointer-coarse:w-5"
          onChange={(event) => set({ required: event.target.checked })}
        />
        Required
      </label>
      {showsDefault ? (
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="label">Default</span>
            {hasDefault && canEdit ? (
              <button
                type="button"
                className="text-[12px] text-muted underline decoration-line-strong hover:text-ink pointer-coarse:min-h-11"
                onClick={() => {
                  set({ default: null });
                  setEpoch((current) => current + 1);
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
          <PropertyField
            key={epoch}
            spaceId={spaceId}
            property={property}
            value={member.default ?? null}
            label={valueLabel(property.format, member.default, property)}
            timeZone={space.data?.timezone}
            canEdit={canEdit}
            onChange={(value) => set({ default: value })}
            onInvalid={onInvalid}
          />
        </div>
      ) : null}
      {!applies ? (
        calculated ? (
          <p className="text-[12px] text-muted">
            A calculated property cannot be required and takes no default.
          </p>
        ) : (
          <p className="text-[12px] text-muted">
            A unique property takes no default: the second record would always be a duplicate.
          </p>
        )
      ) : !pickable ? (
        <p className="text-[12px] text-muted">
          A default can be chosen once the property exists; it has no options or targets yet.
        </p>
      ) : null}
    </div>
  );
}
