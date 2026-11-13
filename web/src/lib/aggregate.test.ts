import { describe, expect, it } from "vitest";

import type { ObjectSummary } from "@/api/types";
import { summarizeColumn, summaryChoices, summaryFixedLabel } from "@/lib/aggregate";
import { formatDateTime, formatDay } from "@/lib/display";
import type { GridColumn } from "@/lib/grid";

/** A record carrying only the values a case needs. */
function record(title: string, values: ObjectSummary["values"] = {}): ObjectSummary {
  return {
    id: `0193c000-0000-7000-8000-00000000000${title.length}`,
    type: "plant",
    title,
    rev: 1,
    updated_at: "2026-11-11T00:00:00Z",
    values,
    missing_relations: [],
  };
}

/** A view column over a property; the title column is built the way the table builds it. */
function column(key: string, label: string, format?: GridColumn["format"]): GridColumn {
  return { key, label, format };
}

/** The reader's locale, exactly as the module formats numbers. */
function numberText(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

const title = column("title", "Title");

describe("a title column's footer", () => {
  it("counts the rows it shows", () => {
    const rows = [record("Fern"), record("Monstera")];
    expect(summarizeColumn(title, rows, "UTC")).toEqual({
      short: "2 rows",
      long: "Title: 2 rows",
      filled: 2,
      total: 2,
    });
  });
});

describe("a number column's footer", () => {
  const amount = column("amount", "Amount", "number");

  it("shows the sum and the average over the filled cells", () => {
    const rows = [
      record("a", { amount: { value: 1, label: "1" } }),
      record("b", { amount: { value: 2, label: "2" } }),
      record("c"),
    ];
    expect(summarizeColumn(amount, rows, "UTC")).toEqual({
      short: "Σ 3 · avg 1.5",
      long: "Amount: 2 of 3 filled; sum 3; average 1.5; lowest 1; highest 2",
      filled: 2,
      total: 3,
    });
  });

  it("groups thousands and rounds the average in the reader's locale", () => {
    const rows = [
      record("a", { amount: { value: 1200000, label: "1200000" } }),
      record("b", { amount: { value: 2408, label: "2408" } }),
      record("c", { amount: { value: 1, label: "1" } }),
    ];
    const sum = 1202409;
    const summary = summarizeColumn(amount, rows, "UTC");
    expect(summary.short).toBe(`Σ ${numberText(sum)} · avg ${numberText(sum / 3)}`);
    expect(summary.long).toContain(`sum ${numberText(sum)}`);
    expect(summary.long).toContain(`average ${numberText(sum / 3)}`);
  });

  it("counts zero as a value and a non-finite cell as none", () => {
    const rows = [
      record("a", { amount: { value: 0, label: "0" } }),
      record("b", { amount: { value: null, label: "" } }),
    ];
    expect(summarizeColumn(amount, rows, "UTC")).toMatchObject({
      short: `Σ ${numberText(0)} · avg ${numberText(0)}`,
      filled: 1,
      total: 2,
    });
  });

  it("says the column is empty when no cell holds a number", () => {
    const rows = [record("a"), record("b")];
    expect(summarizeColumn(amount, rows, "UTC")).toEqual({
      short: "—",
      long: "Amount: none of the 2 rows have a value",
      filled: 0,
      total: 2,
    });
  });

  it("reads every number in the property's currency", () => {
    const money: GridColumn = { ...amount, display: { currency: "USD" } };
    const moneyText = (value: number) =>
      new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value);
    const rows = [
      record("a", { amount: { value: 1, label: "1" } }),
      record("b", { amount: { value: 2, label: "2" } }),
    ];
    const summary = summarizeColumn(money, rows, "UTC");
    expect(summary.short).toBe(`Σ ${moneyText(3)} · avg ${moneyText(1.5)}`);
    expect(summary.long).toBe(
      `Amount: 2 of 2 filled; sum ${moneyText(3)}; average ${moneyText(1.5)}; lowest ${moneyText(1)}; highest ${moneyText(2)}`,
    );
    expect(summary.filled).toBe(2);
  });

  it("fixes the decimals and drops the separators the display asks for", () => {
    const fixed: GridColumn = { ...amount, display: { decimals: 2, grouping: false } };
    const fixedText = (value: number) =>
      new Intl.NumberFormat(undefined, {
        useGrouping: false,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    const rows = [
      record("a", { amount: { value: 1200000, label: "1200000" } }),
      record("b", { amount: { value: 2408, label: "2408" } }),
    ];
    expect(summarizeColumn(fixed, rows, "UTC").short).toBe(
      `Σ ${fixedText(1202408)} · avg ${fixedText(601204)}`,
    );
  });

  it("keeps the 0.8.1 reading for a display that only aligns", () => {
    const aligned: GridColumn = { ...amount, display: { align: "right" } };
    const rows = [record("a", { amount: { value: 1204, label: "1204" } })];
    expect(summarizeColumn(aligned, rows, "UTC").short).toBe(
      summarizeColumn(amount, rows, "UTC").short,
    );
  });
});

describe("a checkbox column's footer", () => {
  const watered = column("watered", "Watered", "checkbox");

  it("counts checked cells against the booleans it found", () => {
    const rows = [
      record("a", { watered: { value: true, label: "" } }),
      record("b", { watered: { value: false, label: "" } }),
      record("c"),
    ];
    expect(summarizeColumn(watered, rows, "UTC")).toEqual({
      short: "1 of 2 checked",
      long: "Watered: 2 of 3 filled; 1 checked",
      filled: 2,
      total: 3,
    });
  });

  it("counts a false cell as filled", () => {
    const rows = [record("a", { watered: { value: false, label: "" } })];
    expect(summarizeColumn(watered, rows, "UTC")).toMatchObject({
      short: "0 of 1 checked",
      filled: 1,
    });
  });
});

describe("a date column's footer", () => {
  const due = column("due", "Due", "date");
  const shortDay = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  it("shows the earliest and latest day it shows", () => {
    const rows = [
      record("a", { due: { value: "2026-11-09", label: "Nov 9" } }),
      record("b", { due: { value: "2026-03-03", label: "Mar 3" } }),
      record("c"),
    ];
    const early = shortDay.format(new Date("2026-03-03T00:00:00Z"));
    const late = shortDay.format(new Date("2026-11-09T00:00:00Z"));
    expect(summarizeColumn(due, rows, "UTC")).toEqual({
      short: `${early} – ${late}`,
      long: `Due: 2 of 3 filled; earliest ${formatDay("2026-03-03")}; latest ${formatDay("2026-11-09")}`,
      filled: 2,
      total: 3,
    });
  });
});

describe("a datetime column's footer", () => {
  const at = column("at", "Completed", "datetime");
  const zone = "America/Toronto";

  it("reads its instants in the space's zone", () => {
    const rows = [
      record("a", { at: { value: "2026-11-09T23:30:00Z", label: "x" } }),
      record("b", { at: { value: "2026-03-03T02:00:00Z", label: "y" } }),
    ];
    const short = (iso: string) =>
      new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: zone }).format(
        new Date(iso),
      );
    expect(summarizeColumn(at, rows, zone)).toEqual({
      short: `${short("2026-03-03T02:00:00Z")} – ${short("2026-11-09T23:30:00Z")}`,
      long: `Completed: 2 of 2 filled; earliest ${formatDateTime("2026-03-03T02:00:00Z", zone)}; latest ${formatDateTime("2026-11-09T23:30:00Z", zone)}`,
      filled: 2,
      total: 2,
    });
  });
});

describe("a text-like column's footer", () => {
  it("counts distinct labels, case-sensitively", () => {
    const room = column("room", "Room", "select");
    const rows = [
      record("a", { room: { value: "kitchen", label: "kitchen" } }),
      record("b", { room: { value: "Kitchen", label: "Kitchen" } }),
      record("c", { room: { value: "kitchen", label: "kitchen" } }),
      record("d"),
    ];
    expect(summarizeColumn(room, rows, "UTC")).toEqual({
      short: "2 distinct",
      long: "Room: 3 of 4 filled; 2 distinct values",
      filled: 3,
      total: 4,
    });
  });

  it("names a single distinct value in the singular", () => {
    const rows = [record("a", { room: { value: "k", label: "kitchen" } })];
    expect(summarizeColumn(column("room", "Room", "select"), rows, "UTC").long).toBe(
      "Room: 1 of 1 filled; 1 distinct value",
    );
  });

  it("treats a multi-select, a URL and an email the same way", () => {
    const rows = [
      record("a", { tags: { value: ["x"], label: "x" } }),
      record("b", { tags: { value: ["y"], label: "y" } }),
    ];
    for (const format of ["multi_select", "url", "email", "text"] as const) {
      expect(summarizeColumn(column("tags", "Tags", format), rows, "UTC")).toMatchObject({
        short: "2 distinct",
        filled: 2,
        total: 2,
      });
    }
  });
});

describe("a column that lists rather than counts", () => {
  it("counts the filled relations", () => {
    const related = column("related", "Related", "relation");
    const rows = [
      record("a", { related: { value: ["id"], label: "Fern" } }),
      record("b"),
    ];
    expect(summarizeColumn(related, rows, "UTC")).toEqual({
      short: "1 filled",
      long: "Related: 1 of 2 filled",
      filled: 1,
      total: 2,
    });
  });

  it("counts an attachment set and a recurrence as one filled cell each", () => {
    const rows = [
      record("a", { files: { value: ["files/a.png"], label: "a.png" } }),
      record("b", { files: { value: ["files/b.png", "files/c.png"], label: "b.png, c.png" } }),
    ];
    expect(summarizeColumn(column("files", "Files", "attachments"), rows, "UTC").short).toBe(
      "2 filled",
    );
    expect(summarizeColumn(column("every", "Every", "recurrence"), rows, "UTC").short).toBe("—");
  });
});

describe("a calculated column's footer", () => {
  it("aggregates a calculated list by its result format", () => {
    // The table hands the footer the result format; the label is the value.
    const computed = column("linked", "Linked", "list");
    const rows = [
      record("a", { linked: { value: ["f"], label: "Fern" } }),
      record("b", { linked: { value: ["f", "m"], label: "Fern, Monstera" } }),
      record("c", { linked: { value: [], label: "" } }),
    ];
    expect(summarizeColumn(computed, rows, "UTC")).toEqual({
      short: "2 distinct",
      long: "Linked: 2 of 3 filled; 2 distinct values",
      filled: 2,
      total: 3,
    });
  });

  it("aggregates a calculated number by its sum", () => {
    const rows = [
      record("a", { total: { value: 2, label: "2" } }),
      record("b", { total: { value: 4, label: "4" } }),
    ];
    expect(summarizeColumn(column("total", "Total", "number"), rows, "UTC").short).toBe(
      "Σ 6 · avg 3",
    );
  });
});

describe("a column whose property is gone", () => {
  it("reports the column as empty rather than inventing values", () => {
    const rows = [record("a"), record("b")];
    expect(summarizeColumn({ key: "gone", label: "Gone" }, rows, "UTC")).toEqual({
      short: "—",
      long: "Gone: none of the 2 rows have a value",
      filled: 0,
      total: 2,
    });
  });
});

describe("a column with a chosen summary measure", () => {
  const rows = [
    record("a", {
      amount: { value: 1, label: "1" },
      due: { value: "2026-03-03", label: "Mar 3" },
      room: { value: "kitchen", label: "kitchen" },
      watered: { value: true, label: "" },
    }),
    record("b", {
      amount: { value: 3, label: "3" },
      due: { value: "2026-11-09", label: "Nov 9" },
      room: { value: "study", label: "study" },
      watered: { value: false, label: "" },
    }),
  ];

  it("prints only the measure it was asked for", () => {
    const highest = { ...column("amount", "Amount", "number"), summary: "highest" as const };
    expect(summarizeColumn(highest, rows, "UTC")).toEqual({
      short: "high 3",
      long: "Amount: 2 of 2 filled; highest 3",
      filled: 2,
      total: 2,
    });

    const lowest = { ...column("amount", "Amount", "number"), summary: "lowest" as const };
    expect(summarizeColumn(lowest, rows, "UTC").short).toBe("low 1");

    const latest = { ...column("due", "Due", "date"), summary: "latest" as const };
    const shortDay = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date("2026-11-09T00:00:00Z"));
    expect(summarizeColumn(latest, rows, "UTC").short).toBe(shortDay);

    const filled = { ...column("room", "Room", "text"), summary: "filled" as const };
    expect(summarizeColumn(filled, rows, "UTC").short).toBe("2 filled");

    const checked = { ...column("watered", "Watered", "checkbox"), summary: "checked" as const };
    expect(summarizeColumn(checked, rows, "UTC").short).toBe("1 of 2 checked");
  });

  it("offers each format only the measures it can compute", () => {
    expect(summaryChoices("number")[0]).toEqual({ value: "", label: "Sum and average" });
    expect(summaryChoices("number").map((choice) => choice.value)).toEqual([
      "",
      "sum",
      "average",
      "lowest",
      "highest",
      "filled",
    ]);
    expect(summaryChoices("date").map((choice) => choice.value)).toContain("latest");
    expect(summaryChoices("text").map((choice) => choice.value)).toContain("distinct");
    expect(summaryChoices("relation")).toEqual([]);
    expect(summaryChoices(undefined, true)).toEqual([]);
  });

  it("names the fixed summary a format cannot choose", () => {
    expect(summaryFixedLabel(undefined, true)).toBe("Row count");
    expect(summaryFixedLabel("relation")).toBe("Filled count");
    expect(summaryFixedLabel("recurrence")).toBe("Filled count");
    expect(summaryFixedLabel("attachments")).toBe("Filled count");
    expect(summaryFixedLabel("number")).toBeNull();
    expect(summaryFixedLabel("text")).toBeNull();
  });
});
