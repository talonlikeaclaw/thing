/** Attachment paths: one URL spelling for a stored file and its thumbnail. */

/** The stored file's name, without its hash directory. */
export function fileName(path: string): string {
  const name = path.split("/").pop() ?? path;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** The member-only read URL for a stored path. */
export function fileUrl(spaceId: string, path: string): string {
  const segments = path.split("/").map((segment) => encodeURIComponent(segment));
  return `/api/spaces/${encodeURIComponent(spaceId)}/${segments.join("/")}`;
}

/** The read URL for a derived thumbnail at one of the two accepted widths. */
export function thumbnailUrl(spaceId: string, path: string, width: 256 | 512 = 256): string {
  return `${fileUrl(spaceId, path)}?w=${width}`;
}

/** A cover focal point in percentages; absent or malformed means the centre. */
export interface CoverPoint {
  x: number;
  y: number;
}

/** Parses the stored `"<x>% <y>%"`; both numbers must be in `0..=100`. */
export function coverPoint(value: string | undefined): CoverPoint {
  const match = /^(\d{1,3})% (\d{1,3})%$/.exec(value?.trim() ?? "");
  if (!match) {
    return { x: 50, y: 50 };
  }
  const x = Number(match[1]);
  const y = Number(match[2]);
  return x <= 100 && y <= 100 ? { x, y } : { x: 50, y: 50 };
}
