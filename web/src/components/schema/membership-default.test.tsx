import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { PropertyDef, TypeProperty } from "@/api/types";
import {
  MembershipDefault,
  defaultApplies,
  defaultPickable,
} from "@/components/schema/membership-default";
import { jsonResponse, renderWithProviders, stubFetch } from "@/test/harness";

const room: PropertyDef = { key: "room", name: "Room", format: "text" };
const member: TypeProperty = { key: "room", required: false, featured: true };
const days: PropertyDef = {
  key: "days",
  name: "Days",
  format: "number",
  compute: { kind: "formula", expression: "1 + 1" },
};

function stubSpace() {
  stubFetch((input) => {
    const url = String(input);
    if (url.endsWith("/api/spaces/s1")) {
      return jsonResponse({
        id: "s1",
        name: "Garden",
        icon: null,
        accent: null,
        timezone: "America/Toronto",
        created_at: "2026-11-01T00:00:00Z",
        role: "owner",
        members: [],
        type_count: 1,
      });
    }
    throw new Error(`unstubbed ${url}`);
  });
}

function renderGroup(
  property: PropertyDef = room,
  current: TypeProperty = member,
  pickable = true,
) {
  stubSpace();
  const onChange = vi.fn();
  renderWithProviders(
    <MembershipDefault
      spaceId="s1"
      member={current}
      property={property}
      canEdit
      pickable={pickable}
      onChange={onChange}
      onInvalid={() => undefined}
    />,
  );
  return onChange;
}

describe("MembershipDefault", () => {
  it("writes Required on the membership", () => {
    const onChange = renderGroup();
    fireEvent.click(screen.getByLabelText("Required"));
    expect(onChange).toHaveBeenCalledWith({ ...member, required: true });
  });

  it("writes a default through the record's own field", () => {
    const onChange = renderGroup();
    fireEvent.change(screen.getByLabelText("Room"), { target: { value: "study" } });
    expect(onChange).toHaveBeenCalledWith({ ...member, default: "study" });
  });

  it("clears a default back to none", () => {
    stubSpace();
    function Controlled() {
      const [current, setCurrent] = useState<TypeProperty>({
        ...member,
        default: "study",
      });
      return (
        <MembershipDefault
          spaceId="s1"
          member={current}
          property={room}
          canEdit
          onChange={setCurrent}
          onInvalid={() => undefined}
        />
      );
    }
    renderWithProviders(<Controlled />);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    // The record's field keeps its draft in local state, so the control has to
    // empty too, not just the membership.
    expect(screen.getByLabelText("Room")).toHaveValue("");
  });

  it("offers no default on a calculated property", () => {
    renderGroup(days, { key: "days", required: false, featured: true });
    expect(screen.queryByText("Default", { selector: "span" })).toBeNull();
    expect(screen.getByLabelText("Required")).toBeDisabled();
    expect(
      screen.getByText(/A calculated property cannot be required/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/A unique property takes no default/)).toBeNull();
  });

  it("offers no default on a unique property", () => {
    renderGroup({ ...room, validation: { unique: true } });
    expect(screen.queryByText("Default", { selector: "span" })).toBeNull();
    expect(screen.getByText(/A unique property takes no default/)).toBeInTheDocument();
  });

  it("says when a default can only be chosen after the property exists", () => {
    renderGroup({ key: "status", name: "Status", format: "select" }, {
      key: "status",
      required: false,
      featured: true,
    }, false);
    expect(screen.queryByText("Default", { selector: "span" })).toBeNull();
    expect(
      screen.getByText(/A default can be chosen once the property exists/),
    ).toBeInTheDocument();
  });
});

describe("defaultApplies", () => {
  it("refuses a calculated or a unique property", () => {
    expect(defaultApplies(room)).toBe(true);
    expect(defaultApplies({ ...room, validation: { unique: true } })).toBe(false);
    expect(defaultApplies(days)).toBe(false);
  });
});

describe("defaultPickable", () => {
  it("names the formats whose value can be chosen before the property exists", () => {
    for (const format of ["text", "number", "checkbox", "date", "datetime", "url", "email"] as const) {
      expect(defaultPickable(format)).toBe(true);
    }
    for (const format of ["select", "multi_select", "relation", "file", "image", "attachments"] as const) {
      expect(defaultPickable(format)).toBe(false);
    }
  });
});
