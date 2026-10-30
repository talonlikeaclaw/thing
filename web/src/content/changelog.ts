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
    version: "0.4.4",
    title: "Usability sweep",
    highlights: [
      "Completing from Schedule or trashing from a record now offers the Undo the table already had.",
      "Tap anywhere on a Schedule row to open the record, with thumb-wide horizon controls that say what they show.",
      "On a phone every saved view is visible at once, and the strip reorders them for the whole space.",
      "Board and gallery cards name their fields, and a gallery cover reads as a tinted band instead of a blank one.",
      "An empty type offers Import CSV beside New record, and the phone Columns panel shows full property names.",
      "A calendar opens on the current week, and Today brings today's row into view.",
      "A relation reads as chips until you ask to change it, and a fresh home leads with Types instead of an empty Recent section.",
    ],
    details: [
      "A completion message names the record it changed, with or without a next due date.",
      "Deleting a space confirms with a message that leaves on its own instead of a warning you must dismiss.",
      "A Schedule row names its type once instead of repeating the type's key.",
      "On a phone the today row stops above the bottom bar instead of sitting behind it.",
      "The Today control is thumb-wide on a touch screen.",
      "The count of records due later is a button that widens the horizon to 30 days.",
      "A long completion label is shortened on Schedule and on a record's schedule line instead of taking the width.",
      "The phone's view button is now More and opens the same menu as the desktop overflow.",
      "View order is saved in the type itself, so it survives a reload and reaches every member.",
      "The default view always sits first, and making another view the default moves it there.",
      "Home recents, palette results and a record's metadata name the type rather than printing its key.",
      "Capture lists types by name, and a required field says only that it is required.",
      "A typed relation stops repeating the type on every target row.",
      "An open relation names the type instead of its key.",
      "On a phone the Columns panel shows each property's full name without a key squeezing it.",
      "The Columns panel no longer tells a touch screen to drag a header edge.",
      "Adding a relation from the table now says that a several-target relation is created in the Schema property library.",
      "The calendar's TODAY label no longer spills into the next day on a narrow phone.",
      "Opening a record no longer reads up to 500 possible relation targets before showing it.",
      "Escape closes the relation picker without leaving the record.",
      "A sheet's Back and Close sit together instead of at opposite ends of the header.",
      "In left-handed mode a record's complete button moves to the thumb side with the rest of the record's actions.",
      "A record's more menu opens its type's editor directly, above Duplicate.",
      "Quick capture asks before throwing away a title or values you typed.",
      "A phone shows an amber dot beside the wordmark while the connection is down.",
      "The palette says it searches titles, which is what it reads today.",
      "The accent reset reads Reset to Lichen instead of looking like a second choice.",
      "The last owner's role and Remove controls are disabled with the reason, instead of failing on the server.",
      "Capture comes before Shortcuts in the header, so the least-used control sits last.",
    ],
  },
  {
    version: "0.4.3",
    title: "Touch follow-through",
    highlights: [
      "On a phone the emoji picker opens in front of the form, drops the keyboard and fills the screen with the grid.",
      "The picker remembers recent emoji and opens at the current icon.",
      "Toasts appear above the keyboard, and above the phone bar when the keyboard is down.",
      "The phone type page's toolbar fits five controls in one row, with one View menu and a single change band.",
      "Cancel in the phone search clears the query instead of hiding the field.",
      "Capture opens the type of the page you are on, and switching type keeps the values you entered.",
      "No text on any page renders below 11px.",
    ],
    details: [
      "Custom emoji accept families, flags and other multi-part characters.",
      "Tapping the picker's search raises the keyboard, and the sheet shrinks above it.",
      "A type's header shows — records while its list loads.",
      "The Complete button on Schedule uses each type's own completion label.",
      "Edit type opens that type's editor.",
      "The connection state no longer moves Search and Capture when the signal drops.",
      "The one exception to the 11px floor is the mono key under a desktop table header.",
    ],
  },
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
