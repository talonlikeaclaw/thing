import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  PromotePlan,
  PromoteRequest,
  PropertyDef,
  TypeSummary,
} from "@/api/types";
import { PromoteColumnDialog } from "@/components/schema/promote-column";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";

const nursery: PropertyDef = { key: "nursery", name: "Nursery", format: "text" };
const shared: PropertyDef = { key: "room", name: "Room", format: "select" };

const plant: TypeSummary = {
  key: "plant",
  name: "Plant",
  name_plural: "Plants",
  description: "",
  schedule: false,
  property_count: 2,
  object_count: 4,
};

const vs: TypeSummary = {
  key: "nursery",
  name: "Nursery",
  name_plural: "Nurseries",
  description: "",
  schedule: false,
  property_count: 0,
  object_count: 2,
};

function plan(overrides: Partial<PromotePlan> = {}): PromotePlan {
  return {
    source: {
      type_key: "plant",
      key: "nursery",
      name: "Nursery",
      format: "text",
      records: 4,
      distinct: 2,
      empty: 1,
    },
    target: {
      key: "nursery",
      name: "Nursery",
      name_plural: "Nurseries",
      icon: null,
      create: true,
      values: [
        { title: "Verdant", records: 2, exists: false },
        { title: "Leaf and Co", records: 1, exists: false },
      ],
      create_records: 2,
    },
    relation: { key: "nursery_ref", name: "Nursery", multi: true },
    links: 3,
    views: [
      {
        key: "all",
        name: "All",
        columns: true,
        sorts: 0,
        filters_moved: 0,
        filters_dropped: 0,
      },
      {
        key: "nurseries",
        name: "Nurseries",
        columns: true,
        sorts: 1,
        filters_moved: 1,
        filters_dropped: 1,
      },
    ],
    warnings: [],
    blocking: [],
    ...overrides,
  };
}

interface ServerOptions {
  /** The plan returned to `plan`, before per-test overrides. */
  plan?: PromotePlan;
  /** Fail this many `links` calls before succeeding. */
  failLinks?: number;
  /** Extra properties the space already declares, for the resume case. */
  properties?: PropertyDef[];
  types?: TypeSummary[];
}

function server(options: ServerOptions = {}) {
  const stages: string[] = [];
  let linksFailures = options.failLinks ?? 0;
  const bodies: PromoteRequest[] = [];
  stubFetch((input, init) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/spaces/s1/properties")) {
      return jsonResponse([nursery, shared, ...(options.properties ?? [])]);
    }
    if (url.endsWith("/api/spaces/s1/types")) {
      return jsonResponse([plant, vs, ...(options.types ?? [])]);
    }
    if (url.includes("/api/spaces/s1/types/plant/promote")) {
      const body = JSON.parse(String(init?.body)) as PromoteRequest;
      stages.push(body.stage);
      bodies.push(body);
      if (body.stage === "plan") {
        return jsonResponse(options.plan ?? plan());
      }
      if (body.stage === "targets") {
        return jsonResponse({
          type: "nursery",
          type_created: true,
          created: 2,
          records: [],
        });
      }
      if (body.stage === "links") {
        if (linksFailures > 0) {
          linksFailures -= 1;
          return jsonResponse(
            { error: { code: "internal", message: "a temporary failure" } },
            500,
          );
        }
        return jsonResponse({
          property: "nursery_ref",
          created: true,
          links: 3,
          filters_dropped: 1,
          views: [],
        });
      }
      if (body.stage === "finish") {
        return jsonResponse({ key: "nursery", finished: true });
      }
    }
    throw new Error(`unstubbed ${url}`);
  });
  return { stages, bodies };
}

function renderDialog(onClose = vi.fn(), property: PropertyDef = nursery) {
  return renderWithProviders(
    <PromoteColumnDialog
      spaceId="s1"
      typeKey="plant"
      property={property}
      onClose={onClose}
    />,
    { route: "/s/s1/t/plant" },
  );
}

describe("PromoteColumnDialog", () => {
  it("previews counts, values, view changes and the CSV backup", async () => {
    server();
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Preview migration" }));

    expect(await screen.findByText("Distinct values")).toBeInTheDocument();
    expect(screen.getByText("Empty").nextElementSibling).toHaveTextContent("1");
    expect(screen.getByText("Links").nextElementSibling).toHaveTextContent("3");
    expect(screen.getByText("Verdant")).toBeInTheDocument();
    expect(screen.queryByText("and 1 more")).not.toBeInTheDocument();
    expect(screen.getByText(/1 sort move/)).toBeInTheDocument();
    expect(screen.getByText(/1 filter drop/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Download CSV backup/ }),
    ).toHaveAttribute("href", "/api/spaces/s1/types/plant/export");
    expect(screen.getByRole("button", { name: "Create Nursery" })).toBeEnabled();
  });

  it("limits the sample to twenty values and names the rest", async () => {
    const values = Array.from({ length: 23 }, (_, index) => ({
      title: `Value ${index + 1}`,
      records: 1,
      exists: false,
    }));
    server({ plan: plan({ target: { ...plan().target, values, create_records: 23 } }) });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Preview migration" }));

    expect(await screen.findByText("Value 20")).toBeInTheDocument();
    expect(screen.queryByText("Value 21")).not.toBeInTheDocument();
    expect(screen.getByText("and 3 more")).toBeInTheDocument();
  });

  it("disables Create while blocking reasons exist", async () => {
    server({
      plan: plan({ blocking: ["room is carried by 2 types"] }),
    });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Preview migration" }));

    expect(await screen.findByText("This column cannot be promoted")).toBeInTheDocument();
    expect(screen.getByText("room is carried by 2 types")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Nursery" })).toBeDisabled();
  });

  it("needs an acknowledgement before warnings allow Create", async () => {
    server({
      plan: plan({
        warnings: ["the column is required, but the new relation is optional"],
      }),
    });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Preview migration" }));
    const create = await screen.findByRole("button", { name: "Create Nursery" });
    expect(create).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "I understand these warnings." }));
    expect(create).toBeEnabled();
  });

  it("runs targets, links and finish in order and closes", async () => {
    const { stages } = server();
    const onClose = vi.fn();
    renderDialog(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Preview migration" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create Nursery" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(stages).toEqual(["plan", "targets", "links", "finish"]);
  });

  it("retries only the failed stage and finishes the run", async () => {
    const { stages } = server({ failLinks: 1 });
    const onClose = vi.fn();
    renderDialog(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Preview migration" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create Nursery" }));

    expect(await screen.findByText(/Could not link the records/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(stages).toEqual(["plan", "targets", "links", "links", "finish"]);
  });

  it("adopts an existing temporary relation instead of planning a second type", async () => {
    const { bodies } = server({
      properties: [
        {
          key: "nursery_ref",
          name: "Grower",
          format: "relation",
          target_type: "nursery",
          multi: true,
        },
      ],
    });
    renderDialog();

    const relation = screen.getByLabelText("Relation name");
    await waitFor(() => expect(relation).toHaveValue("Grower"));

    fireEvent.click(screen.getByRole("button", { name: "Preview migration" }));
    await screen.findByText("Distinct values");
    expect(bodies[0]?.target_type).toBe("nursery");
  });
});
