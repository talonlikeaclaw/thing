# Features

This is the complete feature list for the current release (`0.9.3`). The plan each milestone shipped against is
in [`docs/plan/`](plan/).

## Schema and properties

- **Schema editing.** A record's Properties header adds or manages fields and searches the list
  once it grows past eight; a property is chosen by typing its name rather than scrolling a native
  select. The schema page has Types and Properties tabs with search and a phone master-detail flow.
- **Formats.** Text, number, checkbox, date, date-time, select, multi-select, relation, recurrence,
  URL, email, file, image and attachments, plus the computed-only `list` format.
- **Column promotion.** A text, select or multi-select column can be converted into a relation to a
  new type. The preview lists every distinct value, link, view move and dropped filter, and offers a
  CSV backup. The migration runs as resumable target, link and finish stages. The column keeps its
  name and key, and old values remain in each record's history.
- **Calculated properties.** A property can hold a value the app derives: a **formula** over the
  record's fields and schedule keys (`days(last_completed_at, today())`, `price * quantity`,
  `if(stock > 0, "In stock", "Out")`), or a **summary** over linked records with `count`, `sum`,
  `min`, `max` or `list`. Both use the same form as stored properties, with the result type chosen
  beside the kind and a reference listing the fields and functions the type can use.
  Calculated values are read-only, and they filter, sort and export like stored values; they are
  not written to files. `list` joins display labels (`Monstera, Fern`). Renaming a property updates
  every reference to it, and a referenced property or a summary's linked type cannot be deleted
  while it is named.
- **Identity and keys.** A record is a UUIDv7 in frontmatter, so renaming, retyping or moving its
  file does not break a link. Type and property keys are lowercase slugs and are what files store;
  display names can be changed without changing data.

## Views

- **Named views.** Each type can have a table with per-view columns and widths, a board grouped by
  a select property, a gallery with a property as its cover, and a calendar on a date property such
  as a schedule's due date. Column layout saves as you edit it; filters and sorts save when you
  press **Save view**. The selected view is in the URL.
- **Filter, sort and columns.** These open as popovers over the table on a wide screen and as one
  View sheet on a phone, so records do not move under an open panel. Each complete condition is a
  removable chip under the toolbar. A scheduled type offers Overdue, Due today, Next 7 days and No
  due date as one-tap filters.
- **Table behavior.** Paging, multi-select and bulk property edits, inline duplicate,
  move-to-trash with Undo, header sorting, a pinned title and dimmed stale rows. **Columns** sits
  beside Filter and Sort with a live count, and **Add property** in the trailing header or that
  panel adds an existing or new property to the type and current view without leaving the table.
- **Keyboard and clipboard.** Select and Multi-select columns sort by option order. Tab moves
  through data cells one at a time, and Shift with an arrow selects a rectangle that copies as a
  spreadsheet block or a markdown table.
- **Totals and numbers.** A band under the table totals the rows on screen and says whether more
  rows exist. A number column can have a currency and fixed decimals, numbers align to the right
  edge of their digits, a column can be pinned left, and the band can be hidden or blanked per
  column.

## Schedules

- **Scheduled types.** A type can track a due date and repeat every N days, weeks or months.
  Completing a record records the completion, advances the cadence and appends a revision. Due,
  overdue and today are calendar days in the space's IANA timezone, not elapsed hours.
- **In-app reminders.** An overdue badge in the space navigation and a Schedule page with Overdue,
  Today and upcoming sections. There are no emails, push notifications or background jobs.
- **Schedule views.** The Schedule page lists one agenda across types, with a range and type
  filter and a remembered horizon. Snooze moves a record's due date by 1–90 days, and the month
  lives in the Calendar.

## Journal and calendar

- **Daily notes.** A space whose settings name a daily type opens today's note from the Today item.
  Each day of the journal has its own address, `/daily/<YYYY-MM-DD>`, and a day without a note
  shows the note's own frame with one **Write this day's note** action. Only today is written on
  arrival; the write is held until the day's read answers, and a refused day offers **Try again**.
- **Stepping a day.** A daily record carries `‹` / `›` to the previous and next day and a Today
  link, as chips in the day's glass header; the day's month is its parent breadcrumb and opens that
  month in the Calendar. The `[`, `]` and `t` keys do the same while no field has focus, and `?`
  lists them under Journal. The space navigation marks Today while a day of the journal is open,
  including the record page a written day becomes.
- **A day's other doors.** A scheduled record's due date, a Schedule row's date, a daily note in
  Search or the space's Activity, and the journal type page's Calendar button all open the day or
  the month. The Search sheet lists today's, yesterday's and tomorrow's note, and a typed
  `YYYY-MM-DD` opens that day.
- **The day's work.** A daily note lists the scheduled records still outstanding that day beside
  its properties, each with its type and due phrase. An editor completes or snoozes a row there,
  with the type's own completion verb and an Undo on each result.
- **Calendar.** `/calendar` shows the space's month or week. A day marks a written note and the
  count still due; its panel lists both, and an editor can complete or snooze a due record there or
  write a missing note. The month states how many of its days are written and, for the current
  month, the run of consecutive days. A failed read states the server's sentence with Retry, and
  the week says it is reading until its notes and work settle. The Calendar and the Schedule link
  to each other, and a week address settles on its Monday.
- **Recognition.** A daily note is a record of the space's daily type whose title is a date. A note
  renamed out of that convention stays an ordinary record and does not appear in the Calendar.
- **Old addresses.** A link to the former journal month or the Schedule's calendar opens the
  Calendar.

## Writing, links and search

- **Body editor.** One markdown body per record, with a toolbar, shortcuts, list continuation, `/`
  commands, `[[` autocomplete and a split preview. Properties hold the structure; the body holds
  the prose.
- **Links and backlinks.** `[[Type/Title]]` body links resolve against the space's live titles. A
  record's Links panel lists outgoing links, relation targets and mentions, and the space graph
  draws both as plain SVG.
- **Search.** `Cmd/Ctrl+K` searches every live title and body through a derived in-memory index and
  returns snippets. The palette also lists types, spaces and actions.
- **Quick capture.** `C` opens a capture sheet for the current page's type and its required
  properties, with Create and Create-and-open. Switching type keeps what has already been typed,
  and the last type is remembered in the browser.
- **History.** Every write appends a revision that can be read from the record.
- **Shortcuts.** `?` lists all shortcuts on a keyboard-capable screen.

## Files and images

- **Attachments.** A file or image can be attached to a record. Bytes are stored in the space's
  `files/` tree, named by their content, so one copy of the directory contains the whole space.
- **File sets.** A record can hold a set of files and photos in one property, shown as a grid of
  thumbnails and edited as one draft: upload, paste or drop, remove, and set any photo as the
  cover.
- **Covers and lightbox.** An image property can fill gallery tiles. A record can have a 16:9 cover
  whose focal point is stored with it. Any image opens in a lightbox that steps through the set and
  closes with Escape. Pasting or dropping an image into a record's body stores it and renders it
  there.
- **File library.** `/s/<space>/library` lists every file and photo in the space with the records
  that use each one, filtered by kind, type and name and sorted by recent, name or size. Space
  settings show the space's attachment size and let an owner collect bytes that no record names.
- **Missing files.** A missing file is reported by the space's health read and does not block the
  record. Bytes that a body still renders are not collected as unused.

## Spaces and collaboration

- **Spaces and roles.** A deployment holds multiple spaces. People join by invite link as owner,
  editor or viewer.
- **Live updates.** Open clients refresh through a WebSocket without a reload when another person
  writes.
- **Space settings.** A space can be renamed, given a timezone, given a shared accent color, or
  deleted by typing its name. Icons are chosen from a searchable emoji grid rather than pasted in;
  the same picker serves types and records, starts with recently used emoji, and opens as a sheet
  on a phone. The timezone field filters as you type and offers this device's zone. Timestamps are
  shown in the space's zone.
- **Accent color.** An owner chooses one of six contrast-tested highlight colors. Every member's
  open client changes without a reload. The accent marks focus, selection and the primary action;
  editors and viewers see it but cannot change it.
- **Record icons.** A record can be given an emoji from its header or at capture. The icon appears
  in the table's title cell, home recents, the command palette, board cards, gallery tiles and
  Trash. A record without one keeps its previous layout.

## Data on disk

- **Canonical storage.** One object is one `.md` file with YAML frontmatter. The server keeps a
  rebuildable in-memory index; no database holds space content. Files are written as schema 8, and
  every schema-1…7 file still loads. A record's icon, cover and cover framing are optional
  frontmatter keys rather than properties.
- **Computed values.** A record's computed blocks — a formula's expression, a summary's relation
  and aggregate — are stored, but the values they produce are not. A backup carries what is stored,
  and calculated columns are recomputed on read.
- **Attachments.** Attachment bytes live beside the markdown in each space's `files/` tree, named
  by their content, so a copy of the space directory contains the whole space.
- **CSV.** Every live record of a type can be exported, a header-only template can be downloaded,
  and a reviewed file can be imported with a dry run that names a broken row before anything is
  written.
- **External edits.** Editing the markdown in another editor is noticed by the running app, which
  reflects the change instead of serving or overwriting stale state.
- **Health check.** The reindex command prints a space's file problems: unparseable files, dangling
  relations and attachments whose bytes are missing.

## Phone and accessibility

- **Phone layout.** Search, capture and menus open from the bottom and stay above the on-screen
  keyboard. The page uses the full screen on a notched phone. A toast clears the keyboard and the
  bottom bar, and the emoji picker opens in front of the form it belongs to. The type toolbar is
  Search, Filter and View, with Sort and Columns inside the View sheet. Column widths are literal,
  so a drag moves the column under the finger, and phones hide the resize handles. A phone table
  pins the record's name while it scrolls sideways. Controls are at least 44 × 44 and fields use
  16 px text so focusing one does not zoom the page. Row actions fold into one menu so property
  columns stay reachable, and the bottom bar contains the space drawer, Capture and Search.
- **Handedness.** A browser-local preference in Account settings moves the phone bottom bar, action
  rows, save buttons, row menus and toasts to the chosen thumb. The change is made in the DOM so
  paint, Tab order and screen-reader order agree. It does not mirror text, icons, columns or
  reading order.
- **Color and text.** Any state that relies on color is also shown as text.
