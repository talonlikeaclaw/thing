/**
 * User-facing release notes. Update this list in the same commit that bumps
 * `web/package.json`; the footer reads that version.
 */
export interface ChangelogEntry {
  /** A released version, or `Unreleased` for work on the next one. */
  version: string;
  title: string;
  changes: string[];
  upcoming?: boolean;
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "Unreleased",
    title: "Everyday usability",
    upcoming: true,
    changes: [
      "Capture a record from any space with the header's Capture button or C; only the type's required fields are asked for.",
      "Open a space to a home with recent records, every type and its counts, and the next action; recents stay in this browser and drop trashed records.",
      "New spaces explain types and start at the first one, and an empty table or search now offers the action that fills it.",
      "Every space page now carries the same rail, marks the current page, adds Overview, and turns into a compact space bar on small screens.",
      "Navigation moves focus to the new page's heading, announces the title, restores scroll, and offers a skip-to-content link.",
      "A lost live connection is shown in the header, and a failed session check offers Retry instead of sending you to sign in.",
      "Toasts pause while you hover or focus them, and one carrying Undo is no longer pushed out by newer messages.",
      "Open a command palette with Cmd/Ctrl+K to reach spaces, types, records and actions.",
      "Reach every shortcut from the header's Shortcuts button, or press ?.",
      "Reorder the space rail's links; the order is kept in this browser.",
      "The footer names the running build and links to these notes.",
    ],
  },
  {
    version: "0.3.0",
    title: "Saved views",
    changes: [
      "Save named table, board, gallery and calendar views on every type.",
      "Each view keeps its own columns, widths, filter and sorts, with one default.",
      "Switch views from the type page; the selected view lives in the URL.",
    ],
  },
  {
    version: "0.2.0",
    title: "Scheduling and recurrence",
    changes: [
      "Give a type a due date, a recurrence and a last-completed stamp.",
      "Complete a record and let the next due date advance from the completion day.",
      "See overdue and upcoming work on the Schedule page and in the rail badge.",
      "Set the space's timezone so due dates are calendar days where you live.",
    ],
  },
  {
    version: "0.1.0",
    title: "First release",
    changes: [
      "Create spaces, invite people and choose owner, editor or viewer.",
      "Define your own types and properties, then write records as markdown files.",
      "Filter, sort and edit the live table; read history and recover from trash.",
    ],
  },
];
