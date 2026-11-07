import { describe, expect, it } from "vitest";

import {
  coverPoint,
  fileName,
  fileUrl,
  imagePaths,
  isAcceptedImageType,
  isImagePath,
  thumbnailUrl,
} from "@/lib/files";

describe("attachment paths", () => {
  it("spells one URL for a path and its thumbnail", () => {
    expect(fileUrl("s1", "files/abc/photo.png")).toBe(
      "/api/spaces/s1/files/abc/photo.png",
    );
    expect(fileUrl("s1", "files/a b/x y.png")).toBe(
      "/api/spaces/s1/files/a%20b/x%20y.png",
    );
    expect(thumbnailUrl("s1", "files/abc/photo.png", 512)).toBe(
      "/api/spaces/s1/files/abc/photo.png?w=512",
    );
    expect(fileName("files/abc/photo.png")).toBe("photo.png");
  });

  it("reads a focal point in range and falls back to the centre", () => {
    expect(coverPoint("20% 70%")).toEqual({ x: 20, y: 70 });
    expect(coverPoint(undefined)).toEqual({ x: 50, y: 50 });
    expect(coverPoint("120% 20%")).toEqual({ x: 50, y: 50 });
    expect(coverPoint("20%")).toEqual({ x: 50, y: 50 });
  });

  it("recognizes only the image types the decoder accepts", () => {
    expect(isImagePath("files/abc/photo.png")).toBe(true);
    expect(isImagePath("files/abc/photo.JPG")).toBe(true);
    expect(isImagePath("files/abc/notes.pdf")).toBe(false);
    expect(isAcceptedImageType("image/webp")).toBe(true);
    expect(isAcceptedImageType("image/svg+xml")).toBe(false);
  });

  it("takes the image entries of an attachments value in order", () => {
    expect(
      imagePaths(["files/a/one.png", "files/b/notes.pdf", "files/c/two.webp"]),
    ).toEqual(["files/a/one.png", "files/c/two.webp"]);
    expect(imagePaths("files/a/one.png")).toEqual([]);
    expect(imagePaths(null)).toEqual([]);
    expect(imagePaths([1, null, "files/a/one.gif"])).toEqual(["files/a/one.gif"]);
  });
});
