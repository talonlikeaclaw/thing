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
    version: "0.4.2",
    title: "Mobile craft",
    highlights: [
      "Every sheet — search, capture, shortcuts, menus — opens above the on-screen keyboard instead of behind it.",
      "Search from the phone bar puts the caret in the field on the first tap.",
      "A table column now resizes by exactly the distance you drag, and no neighbouring column moves.",
      "On a phone the record name stays pinned while the table swipes sideways, and columns are wide enough to read.",
      "The type page fits its toolbar into one row, and a record's title gets its own line.",
      "Every control on a phone is at least 44 × 44, and fields are 16 px, so focusing one no longer zooms the page.",
      "Left-handed mode now covers the table, the phone toolbar and each sheet's Close.",
    ],
    details: [
      "Pages use the full screen on a notched phone, and the bottom bar, toasts and sheet footers clear the home indicator.",
      "Sheets animate open; motion stops when the system asks for reduced motion.",
      "Phones hide the column resize handles; resizing stays a desktop gesture.",
      "Selecting rows keeps the table where you left it.",
      "The pager appears only when there is another page.",
      "A record's id and revision sit behind one mono line with a copy button.",
      "Quick capture asks for the required fields first; the rest open under Other fields.",
      "A board card on a phone shows one actions button, and a calendar chip opens the day's records.",
      "The space chevron sits beside the space name, and a lost connection shows as a dot in the phone bar.",
    ],
  },
  {
    version: "0.4.1",
    title: "Everyday usability follow-ups",
    highlights: [
      "Choose one shared highlight accent for a space; an owner sets it and everyone's open space changes live.",
      "Give a record an icon from its header or when you create it, and see it everywhere the record appears.",
      "Add a property from the table, choosing one from the library or creating it with a name and format.",
      "Turn on Left-handed mode to move the phone bar, action rows, save buttons, menus and toasts to your thumb.",
      "Sort Select and Multi-select columns by their option order instead of alphabetically.",
      "Open Columns from the table toolbar, with a count of the property columns shown.",
      "Open a select on the last row: its option list stays on screen instead of being clipped.",
      "Read each header's sort direction from its arrow, its label and the Sort panel.",
      "Sign out with a confirmation that warns about an unsaved draft.",
      "Press C to capture a record; the header now advertises the key.",
    ],
    details: [
      "Editors and viewers see the shared accent; only an owner changes it.",
      "A record icon survives Duplicate and Trash and appears in history.",
      "A record without an icon keeps its old layout, with no empty box.",
      "A property added from the table is featured on the record.",
      "A property added from the table is added to this view only; other views keep their columns.",
      "A failed add names the step that failed; Retry finishes without creating a second property.",
      "Handedness is saved in this browser and moves controls only, never text, icons, columns or reading order.",
      "Sorting, filtering, paging and view changes keep the page and table where they are.",
      "A value whose option was deleted sorts after every known option.",
      "The rail puts All spaces, Overview and the space pages above Types.",
      "A phone type row keeps its icon and full name, hiding the key and counts until there is room.",
      "A space's header actions line up with the content below the rail.",
      "The space sheet keeps Reorder beside Close and points to Types when they are below the fold.",
      "Every rail and sheet link carries an icon.",
      "Files are written as schema 4; earlier files still open, but an older version cannot read them, so back up the data directory first.",
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
