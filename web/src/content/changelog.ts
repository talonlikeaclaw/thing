/**
 * User-facing release notes. Lead with the handful of changes worth showing;
 * put the long tail in `details`, which the page folds away. Update this list
 * in the same commit that bumps `web/package.json`; the footer reads that
 * version.
 */
export interface ChangelogEntry {
  /** A released version, or `Unreleased` for work on the next one. */
  version: string;
  title: string;
  /** The headline changes, always visible. */
  highlights: string[];
  /** The supporting changes, folded behind a disclosure. */
  details?: string[];
  upcoming?: boolean;
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "Unreleased",
    title: "Everyday usability",
    upcoming: true,
    highlights: [
      "Capture a record from any space with the header's Capture button or C; only the type's required fields are asked for.",
      "Open a space to a home with recent records, every type and its counts, and the next action; recents stay in this browser and drop trashed records.",
      "Select table rows and set one property on all of them; the bar names the value and the count before anything is written.",
      "Open a command palette with Cmd/Ctrl+K to reach spaces, types, records and actions.",
      "Reach every shortcut from the header's Shortcuts button, or press ?.",
      "A lost live connection is shown in the header, and a failed session check offers Retry instead of sending you to sign in.",
      "Export any type to CSV, download a header-only template, and import records back with a preview that refuses a broken row before writing.",
    ],
    details: [
      "Quick capture remembers the last type you captured in this browser.",
      "Bulk edits hold the chosen value in a summary before writing, can't remove a required property or leave one empty, and name the property and count in the result.",
      "Finished bulk actions clear only the rows they changed, and rows that failed stay selected for retry.",
      "Every space page now carries the same rail, marks the current page, adds Overview, and turns into a compact space bar on small screens.",
      "Navigation moves focus to the new page's heading, announces the title, restores scroll, and offers a skip-to-content link.",
      "New spaces explain types and start at the first one, and an empty table or search now offers the action that fills it.",
      "Toasts pause while you hover or focus them, and one carrying Undo is no longer pushed out by newer messages.",
      "Reorder the space rail's links; the order is kept in this browser.",
      "The footer names the running build and links to these notes, which now lead with highlights and fold the rest away.",
      "The type page's Data panel exports every live record; import is create-only, uses property keys as its header, and is all-or-nothing at validation.",
    ],
  },
  {
    version: "0.3.0",
    title: "Saved views",
    highlights: [
      "Save named table, board, gallery and calendar views on every type.",
      "Each view keeps its own columns, widths, filter and sorts, with one default.",
      "Switch views from the type page; the selected view lives in the URL.",
    ],
  },
  {
    version: "0.2.0",
    title: "Scheduling and recurrence",
    highlights: [
      "Give a type a due date, a recurrence and a last-completed stamp.",
      "Complete a record and let the next due date advance from the completion day.",
      "See overdue and upcoming work on the Schedule page and in the rail badge.",
      "Set the space's timezone so due dates are calendar days where you live.",
    ],
  },
  {
    version: "0.1.0",
    title: "First release",
    highlights: [
      "Create spaces, invite people and choose owner, editor or viewer.",
      "Define your own types and properties, then write records as markdown files.",
      "Filter, sort and edit the live table; read history and recover from trash.",
    ],
  },
];
