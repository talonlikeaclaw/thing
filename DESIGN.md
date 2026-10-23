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
  faint: "#747d72"
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
- One lichen accent, used only for state (selection, focus, primary action).
- A keyed index as the recurring structure: a short mono key leads every entry.

## Colors

A near-neutral dark scale carrying one yellow-green accent. The palette is functional: no color
appears without a job.

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
- **Distant Fog** (`{colors.faint}`): placeholders and the quietest metadata.

### Semantic
- **Ember** (`{colors.danger}`): validation errors and destructive intent; text only.
- **Amber** (`{colors.warning}`): degraded state, never decoration.

**The One Accent Rule.** Lichen marks state: focus, selection, the primary action, the wordmark.
It never fills large areas and never appears twice in one row for two different meanings.

**The Light Is Not a Theme Skin Rule.** Light mode keeps the same type scale, rules and hierarchy.
It swaps the ground to bone and darkens lichen for contrast; it does not add shadows, cards or new
ornament.

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
space icons, never as interface iconography.

## Components

### Buttons
- **Shape:** 6px radius, 40px minimum height, 16px horizontal padding.
- **Primary:** lichen ground, accent-ink text, 500 weight, 14px. One per view.
- **Hover / Focus:** brightness shift on hover; a 2px lichen outline with 2px offset on focus.
- **Ghost:** transparent ground, 1px hairline border, ink text; hover lifts the border to
  `{colors.line-strong}` and fills `{colors.raised}`.
- **Disabled:** 50% opacity, no hover change, not-allowed cursor.

### Inputs / Fields
- **Style:** 40px height, 1px `{colors.line}` border, `{colors.ground}` ground, 6px radius, 15px text.
- **Focus:** border turns lichen; the global 2px focus outline remains.
- **Error:** border and message in ember, message at 13px with `role="alert"`.
- **Labels:** uppercase mono 11px above the field, 6px gap; hints and errors sit below at 13px.

### Navigation
- **App header:** 64px tall, hairline bottom rule, wordmark at left, a ghost Search control with
  the platform shortcut cap, a ghost Shortcuts control, account email and a ghost "Sign out" at
  right. Below `sm`, the two controls become 44px icon buttons; the email is hidden. No sidebar in
  the signed-out surface; the space list is the navigation.
- **Wordmark:** mono "thing" with a 10px lichen square. It is the only decorative use of the accent.
- **Space rail:** **All spaces** stays fixed at the top under a hairline; below it, Schema,
  Schedule, Members, Trash and Settings form one ordered list. A ghost **Reorder links** control
  reveals a 32px up/down pair on each row (44px on coarse pointers), and the order persists per user
  and space in the browser. The active row is lichen text, never a filled chip.
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
- **Toolbar:** search, filter and sort sit above the renderer, with `Save view` (only when the URL
  query differs from the saved view), `Reset`, and `View settings` for editors. Layout edits write
  as they commit; filter and sort edits wait for the explicit save.
- **View settings:** an inline panel for rename, make-default and delete with an inline confirm. The
  kind is shown read-only with "Kind is fixed; create a view to show these records another way".

### Table View
- **Widths:** a `<colgroup>` carries the saved per-view widths; `title` defaults to 240px and other
  columns to 140px, clamped to 80–800px.
- **Resize:** each header ends in a focusable vertical separator labelled `Resize <name>`; arrow
  keys move 16px (Shift: 64px), a pointer drag commits on release, and coarse pointers get a larger
  target with the same widths. Narrow screens scroll the table rather than reflowing it.

### Board View
- **Lanes:** horizontal, in the select property's option order, then unknown option keys, then a
  final `No value` lane only when records lack the value. Each lane is a 17rem ruled column with a
  hairline top border, its option name and a mono count above the cards.
- **Cards:** a `surface` panel with a hairline border and no shadow; the title, then the view's card
  columns as mono key and value. No drag between lanes in M3.

### Gallery View
- **Grid:** 2 columns, 3 from `md`, 4 from `xl`, with a hairline at every tile edge rather than a
  shadow.
- **Cover:** the cover property's label, bottom-aligned on a `surface` panel with a hairline base;
  an empty value falls back to the type icon. No invented gradient, image or generated art until
  file properties exist. The card repeats the title and card columns.

### Calendar View
- **Grid:** Monday-first weeks in a 7-column ruled table; adjacent-month days are recessed with
  `surface/40` and a faint numeral. Cell borders are hairlines (`rule`).
- **Chips:** a link with a single hairline left edge, not a filled pill; at most three per day, then
  mono `+N more`. Today is a mono `TODAY` label and lichen numeral, not a filled block.
- **Navigation:** the month name, ghost previous/next buttons and `Today`, all 44px on coarse
  pointers. A footer counts records with no value for the date property.

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
- **Don't** fill large surfaces with lichen or introduce a second accent.
- **Don't** use emoji as interface icons; they belong only to user-authored space icons.
- **Don't** turn the index into a card grid, add a sidebar before the space exists, or hide the
  create action behind a modal.
- **Don't** set prose in mono or identifiers in sans.
