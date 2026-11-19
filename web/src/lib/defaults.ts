import type { PropertyDef, TypeDef } from "@/api/types";
import { effectiveMembers, effectiveProperties, isComputed } from "@/lib/schema";

/**
 * The values a new record starts with: every member default the caller did not
 * set.
 *
 * A key already in `values` wins, including an explicit `null` — a cleared
 * field stays cleared — and a calculated member is skipped because the server
 * derives its value. The input is never mutated.
 */
export function withDefaults(
  type: TypeDef,
  properties: readonly PropertyDef[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const byKey = new Map(
    effectiveProperties(type, [...properties]).map((property) => [property.key, property]),
  );
  const next = { ...values };
  for (const member of effectiveMembers(type)) {
    if (member.default === undefined || member.default === null) {
      continue;
    }
    if (member.key in next) {
      continue;
    }
    const property = byKey.get(member.key);
    if (!property || isComputed(property)) {
      continue;
    }
    next[member.key] = member.default;
  }
  return next;
}
