import type { AgendaRow } from "@/api/types";

/** The three List buckets, in display order. */
export interface AgendaBuckets {
  overdue: AgendaRow[];
  due_today: AgendaRow[];
  upcoming: AgendaRow[];
}

/**
 * Splits the server's rows into the List's buckets by the status the server
 * classified, preserving the server's order inside each bucket. The rows are a
 * projection, not a second response: the calendar reads the same array.
 */
export function agendaBuckets(rows: AgendaRow[]): AgendaBuckets {
  const buckets: AgendaBuckets = { overdue: [], due_today: [], upcoming: [] };
  for (const row of rows) {
    if (row.status === "overdue") {
      buckets.overdue.push(row);
    } else if (row.status === "today") {
      buckets.due_today.push(row);
    } else if (row.status === "upcoming") {
      buckets.upcoming.push(row);
    }
  }
  return buckets;
}
