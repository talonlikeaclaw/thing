---
name: thing
description: A self-hosted, markdown-backed tracker whose schema you own.
colors:
  ground: "#121512"
  surface: "#1a1e1a"
  raised: "#212621"
  line: "#2d332d"
  line-strong: "#3a423a"
  ink: "#e8ece4"
  muted: "#9aa398"
  faint: "#868e84"
  accent: "#c8d96b"
  accent-ink: "#14180f"
  danger: "#f08a72"
  warning: "#dcaa54"
typography:
  display:
    fontFamily: "IBM Plex Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "IBM Plex Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: "IBM Plex Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0.09em"
rounded:
  field: "6px"
  sheet: "10px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "48px"
  xxl: "64px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.field}"
    padding: "10px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 16px"
    height: "40px"
  input:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "8px 12px"
    height: "40px"
---

# Design System: thing

## Overview

**Creative North Star: "Nocturnal Field Guide"**

The interface is a field index read under a headlamp: dark ground, hairline rules, keys in mono,
annotations in the margin. It treats the user's data the way a naturalist treats a specimen sheet —
the record is the subject; the apparatus around it stays small, aligned and quiet. The product is a
working tool first. The world contributes type, palette, density and one signature move (the keyed
entry), never the navigation model or the controls. Every control is a standard web control.

Density serves the task: rows are compact, counts are tabular, and identifiers are monospaced because
they are data, not decoration. Warmth comes from copy and rhythm, not ornament. The dark surface is
the working default; a light mode inherits the same hierarchy on bone stock, with the accent darkened
for contrast.

**Key Characteristics:**
- Dark ground with near-neutral, slightly green-black surfaces.
- Hairline 1px rules instead of shadows or cards.
- Mono for keys, ids, timestamps and counts; sans for prose and controls.
- One accent per space, chosen by an owner from six contrast-tested palettes and shared by every
  member, used only for state (selection, focus, primary action); Lichen is the default.
- A keyed index as the recurring structure: a short mono key leads every entry.

## Colors

A near-neutral dark scale carrying one accent, Lichen by default (see *Highlight accent* below).
The palette is functional: no color appears without a job.

### Primary
- **Lichen** (`{colors.accent}`): primary action, focus rings, the wordmark square, and the active
  entry's key. Never used as a background wash or for decoration.
- **Lichen Ink** (`{colors.accent-ink}`): text and glyphs on a lichen surface.

### Neutral
- **Night Ground** (`{colors.ground}`): page background and input fields.
- **Understory** (`{colors.surface}`): the signed-out sheet and raised panels.
- **Canopy Shadow** (`{colors.raised}`): hover fill and quiet emphasis.
- **Hairline** (`{colors.line}`): every divider, input border, and table rule.
- **Hairline Lit** (`{colors.line-strong}`): hover borders and underlined links.
- **Moon Ink** (`{colors.ink}`): primary text.
- **Fog** (`{colors.muted}`): secondary text, labels, annotations.
- **Distant Fog** (`{colors.faint}`): placeholders and the quietest metadata; kept at ≥4.5:1 against every ground.

### Semantic
- **Ember** (`{colors.danger}`): validation errors and destructive intent; text only.
- **Amber** (`{colors.warning}`): degraded state, never decoration.

### Highlight accent
Lichen is the baseline. The accent is a property of the space: an owner chooses one of six palettes
in **Space settings > Appearance**, and every member's open client applies it live through the
existing `space.updated` broadcast. Editors and viewers see the current preset with its radios
disabled and the sentence that only an owner can change it; **Use Lichen** is owner-only. The value
lives in `space.yml` under the optional `accent` key (schema 4) and is written through the
owner-only `PATCH /api/spaces/{space}` with the usual double-option shape — absent leaves it,
`null` returns to Lichen, and an unknown id or a hex value is a `422` field `accent`. A hand-edited
unknown value renders as Lichen without breaking the space; the next owner write corrects the file.

The v0.4 browser-local key (`thing:accent:<user>:<space>`) is read once by `SpaceLayout` to seed an
owner's space, deleted only after that PATCH succeeds, and never read again. A non-owner's old local
value is ignored — the owner owns the shared appearance. Signed-out routes and every non-space
route render Lichen.

| id | label | dark accent | dark ink | light accent | light ink |
|---|---|---|---|---|---|
| `lichen` | Lichen | `#c8d96b` | `#14180f` | `#5f6f1e` | `#f7f8f0` |
| `yellow` | Yellow | `#f2d64b` | `#1a1503` | `#6f5d00` | `#fbf9ea` |
| `orange` | Orange | `#f5a24a` | `#1c1204` | `#9a4a00` | `#fdf6ee` |
| `cyan` | Cyan | `#6fdbe8` | `#04181a` | `#00646e` | `#eefcfe` |
| `green` | Green | `#7fe08a` | `#051706` | `#256b33` | `#f0fbf2` |
| `pink` | Pink | `#f49ac1` | `#1d0711` | `#96325f` | `#fdf1f6` |

`web/src/lib/accent.ts` is the single source for the picker and the contrast test; the core's
`accent.rs` owns the ids the API accepts, and `globals.css` mirrors the palettes as
`:root[data-accent=…]` overrides of `--color-accent` and `--color-accent-ink`. Components keep using
those two tokens and never branch on the accent id.

**The Shared Accent Rule.** The accent is one shared property of a space, not a per-person skin. An
owner sets it, every member sees the same state colour, and no client keeps a second local choice
after the one-time seed. Every palette clears
4.5:1 for accent text on ground and ink on accent in both schemes, enforced by
`lib/accent.test.ts`.

**The One Accent Rule.** The chosen accent marks state: focus, selection, the primary action, the
wordmark, the active rail and view tabs. It never fills large areas and never appears twice in one
row for two different meanings. Choosing Yellow does not add a second accent.

**The Light Is Not a Theme Skin Rule.** Light mode keeps the same type scale, rules and hierarchy.
It swaps the ground to bone and darkens the accent for contrast; it does not add shadows, cards or
new ornament.

## Typography

**Display Font:** IBM Plex Sans Variable (fallbacks: ui-sans-serif, system-ui)
**Body Font:** IBM Plex Sans Variable
**Label/Mono Font:** IBM Plex Mono

**Character:** Humanist sans for reading and controls; a technical mono for every identifier,
measurement, count and label. The pairing reads as a field notebook, not a terminal.

### Hierarchy
- **Display** (500, 28px/1.15, -0.02em): auth page titles and page-level headings.
- **Title** (500, 26px/1.2, -0.02em): the space list heading and a space's name.
- **Heading** (500, 17px/1.4): section headings such as "Start a space" and "Members".
- **Body** (400, 15px/1.55): prose and form values; keep measure at 34–52ch.
- **Label** (500, 11px, 0.09em, uppercase, mono): column headers, field labels, roles, keys.
- **Data** (400–500, 12px, mono): ids, timestamps, counts; always tabular numerals.

**The Keys Are Mono Rule.** Anything the system treats as an identifier or measurement is mono and
tabular. Anything a person reads as a sentence is sans.

**The 11px Floor.** No functional text renders below 11px. The one smaller step is the mono property
key echoed under a table header on a fine pointer at 10px; on a phone that line is removed, because
it repeats the label above it and cannot fit beside it. Detector findings below 11px are defects,
not style.

Coarse pointers raise every input to at least 16px so focusing one never zooms the page, and every
control to at least 44 × 44.

## Layout

A single content column capped at 1080px, with 24px side padding. The signed-out screen splits at
the `md` breakpoint into a 400px form column and a flexible margin column separated by a hairline;
below it, the margin moves off-canvas and only the form remains.

The space index is a five-column grid on desktop — key (80px), name (flexible), members (64px),
types (64px), role (96px) — and a three-column grid on mobile (key, name, role) with counts moved
into the entry's annotation. Rows are separated by full-width hairlines, never cards. The create form
sits below the index under a 48px gap, so the next action stays visible without a modal.

Spacing rhythm: 6px inside a label group, 16px between fields, 24px between sections, 48px between
the index and the create form. Use 40px minimum control height; coarse pointers get 44px targets.

### Sheets and the on-screen keyboard

Every overlay — palette, capture, shortcuts, add property, the space drawer, sign-out — shares one
geometry. The sheet viewport is `position: fixed`, spans the **visual** viewport (`--vv-top` /
`--vv-height`, published from `visualViewport`), and the popup is capped at that height minus the
margin. On a phone the sheet rises from the bottom; from `sm` up it is a centred dialog with a
12vh top offset. No overlay positions itself against `inset: 0` or `100dvh`, so none can end under
the keyboard. The last row of a sheet (footer or action row) carries
`padding-bottom: max(<existing>, env(safe-area-inset-bottom))`, and `viewport-fit=cover` makes those
insets real. Sheets animate in over 180ms (8px rise plus fade), fade out over 120ms, and are static
under `prefers-reduced-motion: reduce`. Scrollports contain their overscroll.

The emoji picker joins the set on a compact width or a coarse pointer: it is a bottom sheet on the
same geometry, so it opens **in front of** the capture sheet or the record page instead of above the
trigger, and its footer stays clear of the keyboard. It deliberately does not raise the keyboard on
open — it focuses its own popup so the grid gets the screen. Tapping its search field raises the
keyboard and the sheet shrinks above it. Above `sm` with a fine pointer the picker remains the
anchored popover.

## Elevation & Depth

The system is flat. There are no shadows. Depth is conveyed by tonal steps (ground → surface →
raised) and by 1px rules. A raised surface earns its step through interaction (hover, focus), not
through a permanent shadow. Overlays, when they arrive, use a border and a ground tint rather than a
drop shadow.

**The Hairline Rule.** A divider is 1px of `{colors.line}`. Never a 2px border, never a colored side
stripe, never a shadow standing in for a rule.

## Shapes

Fields and buttons use a 6px radius; the auth sheet may use 10px. Nothing is pill-shaped except a
future compact control that carries its own state. Corners are gently rounded, never soft enough to
read as a card system. Icons are line-drawn at one weight, 16–20px; emoji appear only as user-authored
space, type and record icons, never as interface iconography.

## Components

### Buttons
- **Shape:** 6px radius, 40px minimum height, 16px horizontal padding.
- **Primary:** lichen ground, accent-ink text, 500 weight, 14px. One per view.
- **Hover / Focus:** brightness shift on hover; a 2px lichen outline with 2px offset on focus.
- **Ghost:** transparent ground, 1px hairline border, ink text; hover lifts the border to
  `{colors.line-strong}` and fills `{colors.raised}`.
- **Disabled:** 50% opacity, no hover change, not-allowed cursor.
- **Inline editor actions:** the bar under a compact editor — cadence, multi-select, relation,
  date shortcuts — puts the primary action at the **thumb edge**: last in the DOM at the right edge
  by default, and first in the DOM at the left edge in Left-handed mode. Clear and Cancel precede
  it in right-handed mode and follow it on the left; the row reverses in the DOM so paint, Tab and
  screen-reader order agree. **The primary action sits at the thumb edge and moves in the DOM in
  left-handed mode**; it is never pinned to the right edge by CSS alone. Mouse-dense 28px buttons
  grow to 44px minimum targets on a coarse pointer or a phone-width window. The same thumb edge
  applies to text actions under a field (date Clear/Today, Clear relation). Do not left-align a
  commit inside a cell or sheet on a right-handed layout.

### Inputs / Fields
- **Style:** 40px height, 1px `{colors.line}` border, `{colors.ground}` ground, 6px radius, 15px text.
- **Focus:** border turns lichen; the global 2px focus outline remains.
- **Error:** border and message in ember, message at 13px with `role="alert"`.
- **Labels:** uppercase mono 11px above the field, 6px gap; hints and errors sit below at 13px.

### Navigation
- **App header:** 64px tall, hairline bottom rule; at `lg` it is the page's rail-and-content grid
  on every route — a 13rem column holding the wordmark and a content column holding two groups —
  so an action keeps one x whether or not a space is open. The first group is the global chrome,
  Search with the platform shortcut cap then the keyboard-only Shortcuts control, followed by the
  space's own connection status and Capture with its `C` cap, so opening a space appends to the
  zone instead of pushing the global pair sideways. The second group is the account email, an
  **Account** link and a ghost **Sign out**, which always closes the row at the container's
  trailing edge. Below `lg`, Capture and Search live in the bottom bar instead, so the header keeps
  only the wordmark, a 44px Account and a 44px Sign out; the email is hidden and the two groups sit
  together at the right. The row shapes itself in one order when it runs out of room: the email
  holds from `sm` to `lg` and again from `xl` up, and the space's connection status truncates
  rather than pushing the action or account buttons. The Shortcuts control does not render below
  `sm` or on a coarse pointer, and neither does the palette's key-hint footer. No sidebar in the
  signed-out surface; the space list is the navigation.
- **Account page:** a single centred column at a 52ch measure; it holds no rail and no table, so it
  never runs to the container's trailing edge.
- **Sign out confirmation:** a dialog titled **Sign out?** whose body names the loss — any unsaved
  draft in this browser will be lost. Cancel comes before the action and the action reads
  **Signing out…** while pending; a failed request keeps the dialog open with an inline error and
  **Retry**. The row follows the thumb edge like every action row: the action is last on the right
  and first on the left, so the first tab stop matches the paint order. The dialog itself stays
  centred in both modes.
- **Mobile space drawer:** below `lg` the rail is a fixed bottom bar. Right-handed: space icon
  and name, role and an up chevron leading, then 44px Capture and Search trailing. Left-handed:
  Search and Capture lead (Search on the outer edge) and the space trigger trails with the chevron
  inward and the icon/name pinned to the right. The left area opens a bottom sheet
  with the same space switcher, All spaces, Overview, the five space pages and Types last, a close
  control, focus trapped and returned to the bar, closing on selection or Escape. It is portaled to `body` so the page's
  settle transform cannot trap it.
- **Dialog and sheet close:** close controls follow the sheet's handedness. Right-handed keeps the
  platform-standard trailing close (the title row ends at the right edge, the palette's search row
  ends with its X); left-handed puts the same close control first in the row, with margin and focus
  order moving with it. Sheets with no close control — the sign-out confirmation — keep Escape and
  their Cancel action as the exits in both modes. Dialogs stay centred; only the close position and
  the action rows move.
- **Wordmark:** mono "thing" with a 10px lichen square. It is the only decorative use of the accent.
- **Space rail:** the switcher leads under its own hairline, then **All spaces**, **Overview** and
  one ordered list — Schema, Schedule, Members, Trash and Settings — and **Types** closes the rail
  under a separating hairline. A ghost **Reorder links** control
  reveals a 32px up/down pair on each row (44px on coarse pointers), and the order persists per user
  and space in the browser. The active row is lichen text, never a filled chip. The phone sheet
  keeps the same order.
- **Footer:** the files sentence, a **Changelog** link and mono `v<version>` on one hairline; the
  version comes from the build, not a hand-typed string.

### Space Index Entry
- **Shape:** a full-width row separated by hairlines, never a card.
- **Key:** the last six characters of the space UUID, uppercase mono 11px. It is a button that
  toggles the entry's annotation (`aria-expanded`, `aria-controls`).
- **Name:** 17px medium sans with the user's emoji icon, linked to the space.
- **Counts:** tabular mono 11px, right-aligned under MEMBERS and TYPES headers.
- **Role:** uppercase mono 11px, right-aligned.
- **Annotation:** opens directly beneath the row as a 5rem/1fr definition list in mono 12px, with a
  single hairline left border. It carries the full id, member count and type count.

### Schema Editor
- **Shape:** two columns at `lg` — a keyed list of types or properties on the left, the selected
  editor on the right; on narrow screens the editor follows its list. Hairlines only.
- **List row:** 15px name, mono 11px key, format or count right-aligned. The selected row's text
  turns lichen (`aria-current`); no background fill and no side stripe.
- **Ordering:** membership order is explicit up/down 32px ghost icon buttons, 44px on coarse
  pointers. Column order belongs to a view and lives on the type page, not in this editor.
- **Options:** each row is a colour swatch input, the name field, its mono key once saved, then the
  order and remove controls. A new option is added inline below the list with the same two inputs.
  Option colours are user data; the lichen accent is not implied.
- **Create actions:** "New type" and "New property" reveal an inline form directly under their
  list, never a modal.
- **Save state:** Save stays disabled until something changed; a successful write shows `SAVED` in
  lichen. A viewer sees the same definitions with the controls disabled and no Save.

### View Switcher
- **Tabs:** directly under the type header, one per saved view in file order: kind icon, name, and a
  mono `DEFAULT` marker on the default. Selection is a 1px lichen bottom rule and lichen text, never
  a filled chip. `aria-pressed` carries the state; the row scrolls horizontally at 375px.
- **New view:** a ghost `+ New view` at the end of the row opens an inline form beneath it — name,
  kind choice, and the kind's required property. It never opens a modal and never asks for a column
  list; the new view copies the current default's layout.
- **Toolbar:** search, filter, sort and **Columns** sit above the renderer, with `Save view` (only
  when the URL query differs from the saved view), `Reset`, and `View settings` for editors.
  Columns is a ghost button beside Filter and Sort that names the visible property count
  (`view.columns.length - 1`), toggles the one query panel, and is absent on calendar views. Layout
  edits write as they commit; filter and sort edits wait for the explicit save. The kebab keeps View
  settings, Save as view and Data only. An empty type's state offers **New record** and, for
  editors, **Import CSV**, which opens the same Data panel as the view menu's Data row.
- **Columns panel:** the fixed title first, then the visible columns with move and hide controls,
  then the hidden ones with Show. On a fine pointer each row also prints the property's mono key;
  below `sm` the key is dropped so the name has the width. The width hint speaks about dragging a
  header edge only on a fine pointer; a coarse pointer is told widths are set on a wide screen.
- **View settings:** an inline panel for rename, make-default and delete with an inline confirm. The
  kind is shown read-only with "Kind is fixed; create a view to show these records another way".

### Table View
- **Widths:** a `<colgroup>` carries the saved per-view widths; `title` defaults to 240px and other
  columns to 140px, clamped to 80–800px. A saved width is painted literally — there is no
  proportional fit. A filler column after the last property absorbs the window's leftover space,
  so a wide window fills exactly and a narrow one scrolls. A drag therefore moves the column under
  the finger by the distance dragged and never resizes a neighbour.
- **Resize:** on a fine pointer each header ends in a focusable vertical separator labelled
  `Resize <name>`; arrow keys move 16px (Shift: 64px), a pointer drag commits on release, a drag
  under 3px commits nothing, and a cancel reverts the preview. A layout write is optimistic and
  never dims or disables the table. **Coarse pointers get no resizer at all**: a 16px edge inside a
  44px target cannot be found by a finger, it steals the horizontal swipe, and an accidental
  release would write a width. Narrow screens scroll the table rather than reflowing it.
- **Sort:** the arrow slot is fixed-width so the label never shifts. Unsorted is a faint
  `ArrowUpDown`; ascending and descending are accent `ArrowUp` / `ArrowDown`, and `aria-sort`, the
  button's label ("currently ascending, activate to sort descending"), its `title` and the Sort
  panel use the same words. The glyph mirrors the `sorts` sent to the server; `cycleSort` keeps
  asc → desc → clear and Shift-click adds or removes one key. Below `sm` the toolbar is five 44px
  controls in one row — search (an icon that expands into the field), Filter, Sort, Columns and
  More; Columns is absent on a calendar view. More opens one sheet whose first screen is a menu of
  View settings, Save as view…, and Data — CSV, each panel returning through a Back control. When
  the query or the view has changed, one labelled band under the toolbar carries Save (only when
  the view differs from the saved one) and Reset (whenever a search, filter or sort is applied);
  the band never wraps. Cancel in the expanded search clears the query and collapses the field.
  The pager renders only when there is another page.
- **Add property:** a trailing header cell after the last visible property and before the action
  cell carries a quiet `+ Add property`; it is a normal tab stop, never a grid cell, hover-only or
  a fill. On a narrow table it scrolls into view like any column and does not disturb the sticky
  title offset, the action column or the keyboard grid's `colCount`.
- **Phones:** below 640px the table has one scroller — the document, with its `thead` stuck to the
  viewport top — instead of a short nested box. The checkbox and the title are pinned at the left
  (`z-20` body, `z-30` header) so a row keeps its identity through a sideways swipe; title paints
  136px and property columns 104px. The header label alone names the column: the mono key line is
  removed on a phone and stays in the `title` and `aria-label`. A trailing spacer of the action
  rail's width lets the last column scroll clear of the rail, and the rail itself paints opaque at
  `z-20` so it never shows data through it. Toggling Select preserves `scrollLeft`. The right cell
  carries only Open plus a 44px actions menu (Complete, Duplicate, Move to trash); the saved action
  cell is not 184px of icons over the property columns. The menu is a hairline popover with 44px
  rows and named actions.

### Record Page
- **Title:** the title input owns its line at 26px with nothing beside it; the sticky save bar is the
  only save indicator, and Duplicate and Revert live in the overflow menu.
- **Identity:** the record id and revision collapse into one mono line. A phone shows the last six
  characters; the full id, a copy control and `REV n` sit behind the disclosure. History always
  shows the full id.
- **Metadata:** one line on a phone — `UPDATED <time> · <type>`; wider screens keep created time too.
- **Properties:** the label and the value; the mono key echo under the label is hidden below `sm`
  where it only repeats the label. It stays in the `aria-label` and returns from `sm` up.
- **Keyboard:** the markdown body and the sticky save bar measure against the visual viewport, so the
  bar sits above the on-screen keyboard rather than behind it.

### Board View
- **Lanes:** horizontal, in the select property's option order, then unknown option keys, then a
  final `No value` lane only when records lack the value. Each lane is a 17rem ruled column with a
  hairline top border, its option name and a mono count above the cards.
- **Cards:** a `surface` panel with a hairline border and no shadow; the title, then the view's card
  columns as a property name and its value. The raw key appears only when the property definition
  is missing. No drag between lanes in M3.

### Gallery View
- **Grid:** 2 columns, 3 from `md`, 4 from `xl`, with a hairline at every tile edge rather than a
  shadow.
- **Cover:** a `raised` band with a hairline base, the cover property's label bottom-aligned in it.
  A select cover whose option matches tints the band with that option at low alpha; with no
  matching option the band keeps `raised` and shows the type icon. No invented gradient, image or
  generated art until file properties exist. The card repeats the title and card columns.

### Calendar View
- **Grid:** Monday-first weeks in a 7-column ruled table; adjacent-month days are recessed with
  `surface/40` and a faint numeral. Cell borders are hairlines (`rule`).
- **Chips:** a link with a single hairline left edge, not a filled pill; at most three per day, then
  mono `+N more`. Today is a lichen numeral and, from `sm` up where the cell has room, a mono
  `TODAY` label beside it; the word is dropped below `sm` so it never crosses into the next day.
  The numeral carries `aria-current="date"` and the title `Today`; never a filled block.
- **Navigation:** the month name, ghost previous/next buttons and `Today`, all 44px on coarse
  pointers. A footer counts records with no value for the date property.

### Command Palette
- **Shape:** a bottom sheet below `sm` and a 40rem centred sheet above; one 56px search row with
  the shortcut cap on larger screens, then results grouped as Actions, Records, Types and Spaces.
- **Rows:** title left, mono hint right, a raised ground and accent text for the active row; 44px
  minimum on coarse pointers. The footer states the result count and, on keyboard screens only,
  the arrow/Enter/Escape keys. Focus is trapped; Escape closes; focus returns to the trigger. The
  search field takes focus inside the commit that opens the sheet, so a phone raises the keyboard
  on the first tap, and it is the initial focus in both handedness modes regardless of where the
  close control sits. The same rule applies to Quick capture's title field.

### Quick Capture
- **Shape:** the same two-mode sheet as the palette, 34rem wide on desktop; type, title, then only
  the type's required properties. Create keeps the sheet open and resets the title; Create and open
  navigates. Fields are 16px on coarse pointers and actions 44px.
- **Refusal:** the sheet stays open with the attempted values and an inline error with Retry; a
  second Create is blocked while one is in flight. A space with no types offers the link to make
  one instead of a form.

### Bulk Bar
- **Shape:** a hairline band inside the table scrollport, never a floating card. It names the count
  and property, previews the value, and carries Apply, Clear and the row actions fan-out.
- **Failure:** rows that failed stay selected and are named; the bar never reports a silent
  success, and Undo runs from the page because the bar unmounts with the selection.

### Row Actions and Toasts
- **Row actions:** 32px line icons at one weight on a fine pointer, always present and 44px on
  coarse pointers; on phones they collapse into the actions menu above. Hover turns Duplicate and
  Open to the accent, Move to trash to ember.
- **Toasts:** pinned to the thumb edge — bottom-right by default, bottom-left in left-handed mode —
  24rem maximum, hairline border on `surface`; danger uses ember text and never auto-dismisses.
  Hover or focus pauses the timer, an Undo toast is not evicted, and action text is 44px tall on
  coarse pointers. Safe-area insets keep either edge clear of a notch, and the message, action and
  dismiss order never reverses. On phones the stack sits above the bottom space bar; with the
  keyboard up it lifts above the keyboard instead, so a confirmation raised from a sheet stays
  visible.

### Add Property
- **Entry points:** the table's trailing header cell and a ghost **Add property** below the visible
  and hidden lists in the Columns panel. Editors only; a viewer sees neither.
- **Shape:** a ruled form, not a wizard — one surface with **Existing property** (a select of what
  the type does not declare) or **New property** (name and the existing format list), then one
  action, **Add to table**. Relation defaults to any target and single-valued; Select and
  Multi-select start with no options.
- **Write:** property (when new), then the type's whole member list with `featured: true`, then the
  current view's columns and widths. The dialog stays open until all three succeed; a refusal names
  the stage, keeps the values, and Retry resumes without repeating a completed stage. A property
  created before a later failure is left in the library and said so; success closes with one toast
  naming the property.

### Record Icons
- **Value:** one optional emoji in the record's frontmatter (`icon`, schema 4), cleaned like a space
  or type icon — trimmed, empty absent, arbitrary glyph otherwise. It is metadata, not a property:
  absent from filters, sorts, CSV and the Schedule page, and `icon` is a reserved property key.
- **Header:** a compact icon-picker trigger for an editor and the bare glyph for a viewer. The draft
  carries the icon, so picking one marks the record dirty and saves with the normal **Save** / `Rev`
  PATCH; Revert restores it.
- **Picker:** on a compact width or a coarse pointer the picker is its own bottom sheet in front of
  the form and opens without the keyboard; on a fine pointer it stays an anchored popover. A row of
  recently chosen glyphs leads the grid, opening scrolls the current icon into view, and the custom
  field accepts up to 32 code units so family and flag emoji fit. Recents are a browser-local UI
  preference of the last eight glyphs, never content.
- **Render sites:** the table's title cell, space-home recents, command-palette results, board
  cards, gallery tiles and Trash, plus the history panel's **Icon** diff row. The glyph occupies a
  fixed slot and an absent icon adds no placeholder; the gallery's type-icon cover fallback stays.
- **Not interface iconography:** these are user-authored glyphs, one per record, never used as
  controls or status marks.

### CSV Data Panel
- **Shape:** an inline panel under the type toolbar, never a modal. Export and template are ghost
  controls; import is an editor-only file field with a dry-run preview, then Commit.
- **Report:** a valid preview names the row and field count; a refused file lists row and field
  problems in place and writes nothing. Limits are stated before upload, and a viewer sees Export
  only.

## Do's and Don'ts

### Do:
- **Do** keep the accent to state and the wordmark; if it is not saying "selected", "focused" or
  "primary action", it is the wrong color.
- **Do** use mono for keys, ids, counts, timestamps and labels, and tabular numerals for every number.
- **Do** separate rows and sections with 1px hairlines and spacing, not cards or shadows.
- **Do** name the next action in empty states and errors, in the product's own language.
- **Do** keep the signed-out margin notes factual: they describe what the files and schema are.
- **Do** let a view tab read as text plus a bottom rule, and let the calendar's today read as a
  hairline and a mono label; colour never carries the state alone.

### Don't:
- **Don't** introduce shadows, glass, gradients, glows or colored side stripes.
- **Don't** fill large surfaces with the accent or introduce a second accent.
- **Don't** use emoji as interface icons; they belong only to user-authored space, type and
  record icons.
- **Don't** turn the index into a card grid, add a sidebar before the space exists, or hide the
  create action behind a modal.
- **Don't** set prose in mono or identifiers in sans.
