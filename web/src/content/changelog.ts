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
    title: "Everyday usability follow-ups",
    upcoming: true,
    highlights: [
      "Choose left- or right-handed layout in Appearance: the phone bar, action rows, save buttons, toasts and row menus all move under your thumb.",
      "Add a property straight from the table, from its trailing header cell or the Columns panel — an existing library property or a new one with its format.",
    ],
    details: [
      "The handedness choice is per browser and per person; it moves controls, never reading order, columns or text.",
      "Adding a property attaches it to the type with the record panel featured and appends it to the current view only.",
      "A failed add names the step that failed and Retry resumes without creating a second property.",
      "On a phone the Add property control sits above the row action icons, so it is never behind a sideways swipe.",
    ],
  },
  {
    version: "0.4.0",
    title: "Everyday usability",
    highlights: [
      "Capture a record from any space with the Capture button or C. Only required properties are asked for.",
      "Each space opens on a home page with recent records and every type with its counts.",
      "Select table rows to set one property on all of them.",
      "Command palette (Cmd/Ctrl+K) reaches spaces, types, records and actions.",
      "Press ? or use Shortcuts in the header to see every keyboard shortcut.",
      "A lost connection shows in the header, and a failed session check offers Retry.",
      "Export a type to CSV, download a template, or import records with a preview before anything is written.",
      "Pick a highlight accent for each space from six palettes.",
      "On phones the bottom bar holds the space menu, Capture and Search, and table row actions fold into a menu.",
    ],
    details: [
      "Quick capture remembers the last type you used.",
      "Bulk edits show the property, value and count before writing. Failed rows stay selected for retry.",
      "Space pages share one rail that marks the current page, adds Overview, and becomes a drawer on small screens.",
      "Moving between pages focuses the new heading, and a skip-to-content link is available.",
      "New spaces start at their first type, and empty tables or searches offer the action that fills them.",
      "Toasts pause on hover or focus, and an Undo toast is not replaced by newer ones.",
      "Reorder the space rail's links.",
      "The footer shows the running version and links to these notes.",
      "CSV import creates records only, uses property keys as headers, and refuses rows with problems before writing.",
      "Leaving a page with unsaved changes asks Save, Discard or Stay.",
      "Failed saves keep your text with an inline Retry. A concurrent edit offers Reload, Keep my draft or Save anyway.",
      "Board cards, gallery tiles and calendar chips have Complete, Duplicate and Move to trash. A busy day opens its full list.",
      "View settings edit board grouping, gallery covers and calendar date properties, and can save the current filter as a new view.",
      "Owners can invite, copy, revoke and remove members. Deleting a type or property shows where it is used first, and Trash restores and purges in bulk.",
      "The timezone field filters as you type and offers your device's zone. Timestamps use the space's zone.",
      "Cadence, multi-select and relation editors keep their commit button at the right edge; the date field's Clear and Today match it.",
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
