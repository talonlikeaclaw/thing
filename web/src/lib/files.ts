/** Attachment paths: one URL spelling for a stored file and its thumbnail. */

/** The upload ceiling the server enforces, mirrored for a local refusal. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** The `accept` value for an image picker; the decoder accepts only these. */
export const ACCEPTED_IMAGES = "image/png,image/jpeg,image/webp,image/gif";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif)$/i;

/** Whether a browser-declared MIME type is one the store can decode. */
export function isAcceptedImageType(type: string): boolean {
  return IMAGE_TYPES.includes(type);
}

/** Whether a stored path names bytes an image tile can render. */
export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.test(path);
}

/** The stored file's name, without its hash directory. */
export function fileName(path: string): string {
  const name = path.split("/").pop() ?? path;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** The image paths of an `attachments` value, in the order it stores them. */
export function imagePaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string => typeof entry === "string" && isImagePath(entry),
  );
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
