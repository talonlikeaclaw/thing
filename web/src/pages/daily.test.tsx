import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { DailyPage } from "@/pages/daily";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";
import { todayIn } from "@/lib/timezone";

const space = {
  id: "s1",
  name: "Garden",
  icon: null,
  accent: null,
  timezone: "UTC",
  daily_type: "journal",
  created_at: "2026-10-01T12:00:00Z",
  role: "owner",
  members: [],
  type_count: 1,
};

const types = [
  {
    key: "journal",
    name: "Journal",
    name_plural: "Journals",
    description: "",
    schedule: false,
    property_count: 1,
    object_count: 1,
  },
];

const journalType = {
  key: "journal",
  name: "Journal",
  name_plural: "Journals",
  icon: null,
  description: "",
  schedule: false,
  properties: [
    { key: "mood", required: false, featured: true, default: "ok" },
  ],
  views: [],
  default_view: "table",
};

const moodProperty = {
  key: "mood",
  name: "Mood",
  format: "text",
};

interface DailyList {
  view: string;
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
  objects: unknown[];
}

const emptyList: DailyList = {
  view: "table",
  total: 0,
  offset: 0,
  limit: 1,
  has_more: false,
  objects: [],
};

function stubDaily({
  role = "owner",
  records = emptyList,
  created = null,
}: {
  role?: string;
  records?: DailyList;
  created?: unknown;
} = {}) {
  let written = false;
  const note = created ?? {
    id: "new1",
    type: "journal",
    title: today,
    rev: 1,
    created_at: "2026-11-20T12:00:00Z",
    updated_at: "2026-11-20T12:00:00Z",
    created_by: "u1",
    updated_by: "u1",
    properties: {},
    body: "",
    missing_relations: [],
  };
  return stubFetch((input, init) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/spaces/s1") && init?.method !== "PATCH") {
      return jsonResponse({ ...space, role });
    }
    if (url.endsWith("/api/spaces/s1/types")) {
      return jsonResponse(types);
    }
    if (url.endsWith("/api/spaces/s1/types/journal")) {
      return jsonResponse(journalType);
    }
    if (url.endsWith("/api/spaces/s1/properties")) {
      return jsonResponse([moodProperty]);
    }
    if (url.endsWith("/api/spaces/s1/objects") && init?.method === "POST") {
      written = true;
      return jsonResponse(note, 201);
    }
    if (url.includes("/api/spaces/s1/objects?")) {
      if (written) {
        return jsonResponse({ ...emptyList, objects: [note], total: 1 });
      }
      return jsonResponse(records);
    }
    throw new Error(`unstubbed ${url}`);
  });
}

const today = todayIn("UTC");

function renderDaily() {
  return renderWithProviders(
    <Routes>
      <Route path="/s/:spaceId/daily" element={<DailyPage />} />
      <Route path="/s/:spaceId/o/:objectId" element={<p>record page</p>} />
    </Routes>,
    { route: "/s/s1/daily" },
  );
}

describe("DailyPage", () => {
  it("opens the record already titled with today's date", async () => {
    stubDaily({
      records: {
        ...emptyList,
        objects: [
          {
            id: "o1",
            type: "journal",
            title: today,
            rev: 1,
            updated_at: "2026-11-20T06:00:00Z",
            values: {},
            missing_relations: [],
          },
        ],
      },
    });
    renderDaily();
    await screen.findByText("record page");
  });

  it("creates today's note once, with the type's defaults", async () => {
    const fetchMock = stubDaily();
    renderDaily();
    await screen.findByText("record page", undefined, { timeout: 3000 });
    const posts = fetchMock.mock.calls.filter(
      ([input, init]) =>
        requestUrl(input).endsWith("/api/spaces/s1/objects") && init?.method === "POST",
    );
    expect(posts).toHaveLength(1);
    const body = JSON.parse(String(posts[0]?.[1]?.body)) as {
      title: string;
      properties: Record<string, unknown>;
      type: string;
    };
    expect(body.title).toBe(today);
    expect(body.type).toBe("journal");
    expect(body.properties).toEqual({ mood: "ok" });
  });

  it("tells a viewer an editor can create today's note", async () => {
    const fetchMock = stubDaily({ role: "viewer" });
    renderDaily();
    await screen.findByText("An editor can create today's note.");
    const posts = fetchMock.mock.calls.filter(
      ([input, init]) =>
        requestUrl(input).endsWith("/api/spaces/s1/objects") && init?.method === "POST",
    );
    expect(posts).toHaveLength(0);
  });

  it("names a daily type that no longer exists", async () => {
    stubFetch((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/spaces/s1")) {
        return jsonResponse(space);
      }
      throw new Error(`unstubbed ${url}`);
    });
    renderDaily();
    await screen.findByText(/daily note type \(journal\) is missing/);
  });
});
