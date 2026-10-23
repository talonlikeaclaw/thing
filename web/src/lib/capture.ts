import type { PropertyDef, TypeDef } from "@/api/types";
import { effectiveMembers } from "@/lib/schema";

/** The slice of `Storage` quick capture needs; a fake can stand in for it. */
export interface CaptureStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Per user and per space: the last type this user captured into. */
export function captureTypeKey(userId: string, spaceId: string): string {
  return `thing:quick-capture-type:${userId}:${spaceId}`;
}

/** A malformed or refused value yields `null`, never a throw. */
export function readCaptureType(storage: CaptureStorage, key: string): string | null {
  try {
    const raw = storage.getItem(key);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** Best effort only: a refused write never blocks opening the sheet. */
export function writeCaptureType(
  storage: CaptureStorage,
  key: string,
  typeKey: string,
): void {
  try {
    storage.setItem(key, typeKey);
  } catch {
    // Quota, private mode or a disabled store.
  }
}

/**
 * The properties quick capture must ask for: the type's required declared
 * members, resolved to their definitions. Generated schedule keys are marked
 * optional by `effectiveMembers`, so they never appear here.
 */
export function requiredProperties(
  type: TypeDef | undefined,
  properties: readonly PropertyDef[],
): PropertyDef[] {
  if (!type) {
    return [];
  }
  const byKey = new Map(properties.map((property) => [property.key, property]));
  const required: PropertyDef[] = [];
  for (const member of effectiveMembers(type)) {
    const property = byKey.get(member.key);
    if (member.required && property && !required.some((known) => known.key === property.key)) {
      required.push(property);
    }
  }
  return required;
}
