import type { PropertyDef } from "@/api/types";

/** The server's key limit; the temporary relation keeps its `_ref` suffix. */
const MAX_KEY_LEN = 40;

/**
 * The relation key the links stage writes before finish renames it back. It
 * mirrors the server's rule so the wizard can find a run it already started.
 */
export function temporaryKey(source: string): string {
  const suffix = "_ref";
  const keep = MAX_KEY_LEN - suffix.length;
  const base = source.slice(0, keep).replace(/_+$/, "");
  return base === "" ? "value_ref" : `${base}${suffix}`;
}

/** Why a property cannot be turned into a relation, or `null` when it can. */
export function promotionBlocker(property: PropertyDef, owners: number): string | null {
  if (property.compute) {
    return "A calculated property cannot become a relation.";
  }
  if (
    property.format !== "text" &&
    property.format !== "select" &&
    property.format !== "multi_select"
  ) {
    return "Only text, select and multi-select columns can be turned into a type.";
  }
  if (owners === 0) {
    return "No type carries this property.";
  }
  if (owners > 1) {
    return `This property is used by ${owners} types.`;
  }
  return null;
}
