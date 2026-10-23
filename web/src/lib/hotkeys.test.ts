import { describe, expect, it } from "vitest";

import { hotkeyLabel, isEditableTarget } from "@/lib/hotkeys";

describe("isEditableTarget", () => {
  it("recognises text fields and selects", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
  });

  it("recognises a contenteditable host and its children", () => {
    const host = document.createElement("div");
    host.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    host.append(child);
    document.body.append(host);
    expect(isEditableTarget(host)).toBe(true);
    expect(isEditableTarget(child)).toBe(true);
    host.remove();
  });

  it("does not treat a plain element or a null target as editable", () => {
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("hotkeyLabel", () => {
  it("prints a plain key in upper case", () => {
    expect(hotkeyLabel("k")).toBe("K");
    expect(hotkeyLabel("?")).toBe("?");
  });

  it("prints the platform's modifier cap", () => {
    expect(hotkeyLabel("k", true)).toMatch(/^(⌘K|Ctrl K)$/);
  });
});
