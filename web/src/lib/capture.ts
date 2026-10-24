import type { PropertyDef, TypeDef } from "@/api/types";
import { effectiveMembers, effectiveProperties } from "@/lib/schema";

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

/** Complete owns this generated key; quick capture never offers it. */
const LAST_COMPLETED_KEY = "last_completed_at";

export interface CaptureFields {
  required: PropertyDef[];
  optional: PropertyDef[];
}

/**
 * Every editable field quick capture can send: required declared members
 * first, then the rest in type order. Generated schedule definitions are
 * resolved from the type itself; the completion stamp is omitted because
 * Complete writes it.
 */
export function captureFields(
  type: TypeDef | undefined,
  properties: readonly PropertyDef[],
): CaptureFields {
  if (!type) {
    return { required: [], optional: [] };
  }
  const byKey = new Map(
    effectiveProperties(type, [...properties]).map((property) => [property.key, property]),
  );
  const required: PropertyDef[] = [];
  const optional: PropertyDef[] = [];
  const seen = new Set<string>();
  for (const member of effectiveMembers(type)) {
    const property = byKey.get(member.key);
    if (!property || seen.has(property.key)) {
      continue;
    }
    if (member.required) {
      seen.add(property.key);
      required.push(property);
    } else if (property.key !== LAST_COMPLETED_KEY) {
      seen.add(property.key);
      optional.push(property);
    }
  }
  return { required, optional };
}

export function requiredProperties(
  type: TypeDef | undefined,
  properties: readonly PropertyDef[],
): PropertyDef[] {
  return captureFields(type, properties).required;
}
