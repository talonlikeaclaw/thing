import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  hotkeyLabel,
  isEditableTarget,
  useGlobalHotkeys,
  type HotkeyBinding,
} from "@/lib/hotkeys";

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

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

function bind(run: HotkeyBinding["run"]) {
  renderHook(() => useGlobalHotkeys([{ key: "escape", allowInInput: true, run }]));
}

describe("useGlobalHotkeys", () => {
  it("leaves an unclaimed key for the surface below", () => {
    const run = vi.fn(() => false);
    bind(run);
    const event = pressEscape();
    expect(run).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  });

  it("prevents the default once a binding takes the key", () => {
    const run = vi.fn();
    bind(run);
    const event = pressEscape();
    expect(run).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });
});
