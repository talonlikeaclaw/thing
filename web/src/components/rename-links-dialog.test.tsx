import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MentionBacklink, ObjectDetail } from "@/api/types";
import { RenameLinksDialog, type MentionSource } from "@/components/rename-links-dialog";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";

const mention: MentionBacklink = {
  kind: "mention",
  id: "o2",
  type: "task",
  title: "Water the monstera",
  snippet: "Next to the [[plant/Monstera]].",
  count: 2,
};

const source: ObjectDetail = {
  id: "o2",
  type: "task",
  title: "Water the monstera",
  rev: 3,
  created_at: "2026-11-01T12:00:00Z",
  updated_at: "2026-11-01T12:00:00Z",
  created_by: "u1",
  updated_by: "u1",
  properties: {},
  body: "Next to the [[plant/Monstera]].",
  missing_relations: [],
  links: [
    {
      raw: "plant/Monstera",
      type: "plant",
      title: "Monstera",
      status: "ok",
      id: "o1",
    },
  ],
};

const types = [
  {
    key: "plant",
    name: "Plant",
    name_plural: "Plants",
    description: "",
    schedule: false,
    property_count: 0,
    object_count: 1,
  },
  {
    key: "task",
    name: "Task",
    name_plural: "Tasks",
    description: "",
    schedule: false,
    property_count: 0,
    object_count: 1,
  },
];

function renderDialog(
  overrides: Partial<Parameters<typeof RenameLinksDialog>[0]> = {},
  handler?: (url: string) => Response | undefined,
) {
  stubFetch((input) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/spaces/s1/types")) {
      return jsonResponse(types);
    }
    const described = handler?.(url);
    if (described) {
      return described;
    }
    throw new Error(`unstubbed ${url}`);
  });
  const props = {
    spaceId: "s1",
    oldTitle: "Monstera",
    newTitle: "Monstera deliciosa",
    mentions: [mention],
    pending: false,
    error: null,
    onUpdateLinks: vi.fn(),
    onRenameOnly: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  renderWithProviders(<RenameLinksDialog {...props} />);
  return props;
}

describe("RenameLinksDialog", () => {
  it("previews each source, then hands the pre-rename read back for the rewrite", async () => {
    const onUpdateLinks = vi.fn<(sources: MentionSource[]) => void>();
    renderDialog(
      { onUpdateLinks },
      (url) =>
        url.includes("/objects/o2?with=links,backlinks")
          ? jsonResponse(source)
          : undefined,
    );

    expect(
      screen.getByRole("heading", { name: "Rename and update links?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/“Monstera” becomes “Monstera deliciosa”/)).toBeInTheDocument();
    expect(await screen.findByText(/Water the monstera/)).toBeInTheDocument();
    expect(screen.getByText("×2")).toBeInTheDocument();
    expect(screen.getByText(/2 mentions/)).toBeInTheDocument();

    const update = screen.getByRole("button", { name: "Update links" });
    await waitFor(() => expect(update).toBeEnabled());
    fireEvent.click(update);

    expect(onUpdateLinks).toHaveBeenCalledWith([{ mention, detail: source }]);
  });

  it("still previews a source it could not read, and reports it as skipped later", async () => {
    const onUpdateLinks = vi.fn<(sources: MentionSource[]) => void>();
    renderDialog(
      { onUpdateLinks },
      (url) =>
        url.includes("/objects/o2?with=links,backlinks")
          ? jsonResponse({ error: { code: "not_found", message: "Gone" } }, 404)
          : undefined,
    );

    expect(await screen.findByText(/Some records could not be read/)).toBeInTheDocument();
    const update = screen.getByRole("button", { name: "Update links" });
    await waitFor(() => expect(update).toBeEnabled());
    fireEvent.click(update);

    expect(onUpdateLinks).toHaveBeenCalledWith([{ mention, detail: null }]);
  });

  it("offers rename-only and cancel without touching any source", async () => {
    const onRenameOnly = vi.fn();
    const onCancel = vi.fn();
    renderDialog(
      { onRenameOnly, onCancel },
      (url) =>
        url.includes("/objects/o2?with=links,backlinks")
          ? jsonResponse(source)
          : undefined,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Update links" })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename only" }));
    expect(onRenameOnly).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
