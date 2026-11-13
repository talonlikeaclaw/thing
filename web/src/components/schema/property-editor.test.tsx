import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/use-dirty-guard", () => ({
  useDirtyGuard: () => null,
}));

import type { PropertyDef } from "@/api/types";
import { PropertyEditorForm } from "@/components/schema/property-editor";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";

const formula: PropertyDef = {
  key: "days_since_watered",
  name: "Days since watered",
  format: "number",
  compute: {
    kind: "formula",
    expression: "days(last_completed_at, today())",
  },
};

const room: PropertyDef = { key: "room", name: "Room", format: "text" };
const formulaUsingRoom: PropertyDef = {
  key: "room_length",
  name: "Room length",
  format: "number",
  compute: { kind: "formula", expression: "length(room)" },
};

describe("PropertyEditorForm", () => {
  it("saves an edited formula through the property patch", async () => {
    let body: Record<string, unknown> | null = null;
    stubFetch((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? "GET") === "PATCH") {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          ...formula,
          compute: body?.compute,
        });
      }
      throw new Error(`unstubbed ${url}`);
    });

    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={formula}
        types={[]}
        library={[formula, room]}
        canEdit
      />,
    );

    fireEvent.change(screen.getByLabelText("Expression"), {
      target: { value: "days(last_completed_at, today()) + 1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save property" }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({
      name: "Days since watered",
      compute: {
        kind: "formula",
        expression: "days(last_completed_at, today()) + 1",
      },
    });
  });

  it("names the calculated holders and disables delete", async () => {
    stubFetch((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? "GET") === "DELETE") {
        return jsonResponse(
          {
            error: {
              code: "conflict",
              message: "computed properties use property",
              details: {
                reason: "computed properties use property",
                properties: ["room_length"],
              },
            },
          },
          409,
        );
      }
      throw new Error(`unstubbed ${url}`);
    });

    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={room}
        types={[]}
        library={[room, formulaUsingRoom]}
        canEdit
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete this property" }));

    expect(
      await screen.findByText(/A calculated property uses this property/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Room length" })).toHaveAttribute(
      "href",
      "/s/s1/schema?property=room_length",
    );
    expect(screen.getByRole("button", { name: "Delete this property" })).toBeDisabled();
  });
});

describe("PropertyEditorForm display", () => {
  it("saves a currency with the rest of the property untouched", async () => {
    const amount: PropertyDef = { key: "amount", name: "Amount", format: "number" };
    let body: Record<string, unknown> | null = null;
    stubFetch((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? "GET") === "PATCH") {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ ...amount, display: body?.display });
      }
      throw new Error(`unstubbed ${url}`);
    });

    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={amount}
        types={[]}
        library={[amount]}
        canEdit
      />,
    );

    fireEvent.click(screen.getByText("Display", { selector: "summary" }));
    fireEvent.click(screen.getByLabelText("Open currency list"));
    fireEvent.click(await screen.findByRole("option", { name: "USD" }));
    fireEvent.click(screen.getByRole("button", { name: "Save property" }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({
      name: "Amount",
      display: { currency: "USD" },
    });
  });
});
