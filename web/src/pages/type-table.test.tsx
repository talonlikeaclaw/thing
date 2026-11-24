import { fireEvent, screen } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";

import type { SpaceDetail, TypeDef, ViewDef } from "@/api/types";
import { QuickCaptureProvider } from "@/components/quick-capture";
import { TypeTablePage } from "@/pages/type-table";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";

const tableView: ViewDef = {
  key: "all",
  name: "All",
  kind: "table",
  sorts: [],
  filter: { op: "and", conditions: [] },
  columns: ["title"],
  widths: {},
};

function space(dailyType: string | null): SpaceDetail {
  return {
    id: "s1",
    name: "Garden",
    icon: null,
    accent: null,
    timezone: "UTC",
    daily_type: dailyType,
    created_at: "2026-11-01T00:00:00Z",
    role: "owner",
    members: [],
    type_count: 1,
  };
}

function type(key: string, name: string): TypeDef {
  return {
    key,
    name,
    name_plural: `${name}s`,
    icon: null,
    description: "",
    schedule: false,
    properties: [],
    views: [tableView],
    default_view: "all",
  };
}

function Where() {
  return <p>{`at ${useLocation().pathname}`}</p>;
}

/** The type page's reads, with an empty ledger so both create buttons render. */
function stubTypePage(dailyType: string | null, detail: TypeDef) {
  stubFetch((input, init) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/auth/me")) {
      return jsonResponse({ id: "u1", email: "a@b.c", name: "Talen" });
    }
    if (url.endsWith("/api/spaces/s1") && init?.method !== "PATCH") {
      return jsonResponse(space(dailyType));
    }
    if (url.endsWith("/api/spaces/s1/types")) {
      return jsonResponse([
        {
          key: detail.key,
          name: detail.name,
          name_plural: detail.name_plural,
          description: "",
          schedule: false,
          property_count: 0,
          object_count: 0,
        },
      ]);
    }
    if (url.endsWith(`/api/spaces/s1/types/${detail.key}`)) {
      return jsonResponse(detail);
    }
    if (url.endsWith("/api/spaces/s1/properties")) {
      return jsonResponse([]);
    }
    if (url.includes("/api/spaces/s1/objects?")) {
      return jsonResponse({
        view: "table",
        total: 0,
        offset: 0,
        limit: 50,
        has_more: false,
        objects: [],
      });
    }
    throw new Error(`unstubbed ${url}`);
  });
}

function renderTypePage(typeKey: string) {
  return renderWithProviders(
    <QuickCaptureProvider spaceId="s1">
      <Routes>
        <Route path="/s/:spaceId/t/:typeKey" element={<TypeTablePage />} />
        <Route path="/s/:spaceId/daily" element={<Where />} />
      </Routes>
    </QuickCaptureProvider>,
    { route: `/s/s1/t/${typeKey}` },
  );
}

describe("TypeTablePage create", () => {
  it("opens today's note from the daily type's create action", async () => {
    stubTypePage("journal", type("journal", "Journal"));
    renderTypePage("journal");
    const buttons = await screen.findAllByRole("button", { name: "Today's note" });
    expect(screen.queryByRole("button", { name: "New journal" })).not.toBeInTheDocument();
    fireEvent.click(buttons[0] as HTMLElement);
    await screen.findByText("at /s/s1/daily");
  });

  it("keeps the capture sheet for a type that is not the daily note", async () => {
    stubTypePage("journal", type("plant", "Plant"));
    renderTypePage("plant");
    const buttons = await screen.findAllByRole("button", { name: "New plant" });
    fireEvent.click(buttons[0] as HTMLElement);
    expect(await screen.findByLabelText("Title")).toBeInTheDocument();
  });
});
