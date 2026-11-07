---
name: thing
description: A self-hosted, markdown-backed tracker whose schema you own.
colors:
  ground: "#0a0e0b"
  ground-lift: "#141c16"
  inset: "#070a08"
  surface: "#151a16"
  raised: "#1d231e"
  line: "#293029"
  line-strong: "#3a423a"
  line-interactive: "#6a746a"
  ink: "#edf1e8"
  muted: "#a2ab9f"
  faint: "#8b948b"
  glass: "rgba(30,38,32,0.55)"
  glass-strong: "rgba(36,44,38,0.62)"
  glass-edge: "rgba(255,255,255,0.12)"
  pane-wash: "rgba(10,14,11,0.62)"
  pane-glass: "color-mix(in srgb, {colors.accent} 10%, {colors.glass})"
  accent: "#c8d96b"
  accent-ink: "#14180f"
  accent-on-wash: "#c8d96b"
  accent-wash: "#c8d96b1e"
  accent-wash-hover: "color-mix(in srgb, {colors.accent} 24%, transparent)"
  danger: "#f08a72"
  warning: "#dcaa54"
typography:
  display:
    fontFamily: "Maple Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "36px"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Maple Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "26px"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "IBM Plex Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "normal"
  body:
    fontFamily: "IBM Plex Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  small:
    fontFamily: "IBM Plex Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Maple Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0.09em"
rounded:
  field: "12px"
  card: "18px"
  sheet: "28px"
  pill: "999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "24px"
  space-6: "32px"
  space-7: "48px"
  space-8: "64px"
control:
  fine: "36px"
  standard: "40px"
  coarse: "44px"
  field-fine: "40px"
  field-coarse: "44px"
  icon: "40px"
  icon-coarse: "44px"
  dock: "68px"
  capture: "56px"
  header: "64px"
motion:
  ease-out: "cubic-bezier(0.16, 1, 0.3, 1)"
  fast: "120ms"
  base: "180ms"
  slow: "240ms"
elevation:
  float: "0 20px 50px -22px rgba(0,0,0,0.72)"
  dock: "0 18px 40px -16px rgba(0,0,0,0.66)"
  glass-blur: "24px"
  glass-saturate: "150%"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
    height: "40px"
  button-ghost:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
    height: "40px"
  icon-button:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "40px"
  input:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "8px 12px"
    height: "40px"
  glass-bar:
    backgroundColor: "{colors.glass}"
    rounded: "{rounded.pill}"
    height: "68px"
  sheet:
    backgroundColor: "{colors.glass-strong}"
    rounded: "{rounded.sheet}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
---
# Design System: thing

## Overview

**Creative North Star: "Night Glass"**

thing is a field guide read through a lit instrument. The room is dark and the
instrument is on: a green-black ground under a soft top light, with the system's own
chrome — the header, the rail, the phone dock, sheets, menus, the command palette, the
save state — floating above the page as frosted glass. The user's data never floats.
Tables, ledgers, record bodies, forms and property grids sit on matte, opaque stock so
they stay still and readable while the chrome moves over them.

The world supplies type, palette, density, material and one signature move — the
floating glass dock whose active destination is an inverted circular seal. It does not
supply the navigation model or the controls: routes, permissions, tables, fields and
keyboard behaviour are the standard web ones this product already had.

The reference is the self-hosted travel planner TREK, read from its source rather than
its screenshots: a near-black ground with a radial screen wash, translucent panels at
roughly 60% with a 1px lit edge, 24–40px backdrop blur at 1.8 saturation, full-pill
chrome, 42px circular destinations, a 56px raised action, 26–28px sheets and one wide
ambient shadow. What does not transfer is its travel content: no photographic covers,
no mascots, no playful colour, no card grid of trip tiles.

**Key Characteristics:**
- A top-lit green-black ground: `#141c16` at the top edge falling to `#0a0e0b` and
  `#070a08` at the bottom.
- Frosted glass for chrome only: 55% fill at rest and 62% for sheets in dark, 60% white in
  light, 18–24px blur, 150–160% saturation, one lit 1px edge, one wide ambient shadow.
- Matte, opaque surfaces for data: cards at `#151a16` (bone `#fbfaf5` in light) with a
  single hairline border and no blur.
- Pills for actions and segments, circles for icon actions, 12/18/28px corners for
  fields, cards and sheets. The capture action is the one saturated circle.
- Maple Mono for display, page titles, record titles, keys, counts and labels; IBM Plex
  Sans for sentences. The type voice is unchanged from the field guide.
- One shared accent per space, chosen from six contrast-tested presets. Lichen is the
  default. It marks state, focus and the primary action; it never fills large areas.
- Reading order never moves. Only thumb-zone action order and the dock mirror with
  handedness.

## Colors

The palette is functional. The ground carries the light; the glass carries the chrome;
the accent carries state. No colour appears without a job.

### Ground and matte surfaces
- **Night Ground** (`{colors.ground}`): the page canvas.
- **Ground Lift** (`{colors.ground-lift}`): the top stop of the fixed radial wash; the
  light source that makes the glass legible.
- **Night Inset** (`{colors.inset}`): the bottom stop and the recessed band behind table
  headers.
- **Understory** (`{colors.surface}`): matte cards — the space ledger, the record sheet,
  the table scrollport, a settings section.
- **Canopy Shadow** (`{colors.raised}`): hover fills, inner fields, quiet emphasis.
- **Hairline** (`{colors.line}`): every card border, divider and table rule.
- **Hairline Lit** (`{colors.line-strong}`): hover borders.
- **Field Edge** (`{colors.line-interactive}`): the resting border of an input or a
  filter chip; held at 70% so a field is a soft well, not a drawn box.
- **Moon Ink** (`{colors.ink}`), **Fog** (`{colors.muted}`), **Distant Fog**
  (`{colors.faint}`): primary, secondary and quietest text. Faint is `#8b948b` in dark
  and `#60665d` in light; both clear 4.5:1 on the inset, the surface and the raised step.

### Glass
- **Glass** (`{colors.glass}`): the resting chrome — app header, desktop rail, phone
  dock, toolbars, menus, the record save row. Dark: `rgba(30,38,32,0.55)`; light:
  `rgba(255,255,255,0.60)`.
- **Glass Strong** (`{colors.glass-strong}`): surfaces that must stay readable while the page
  shows through — sheets, the command palette, menus, toasts, the bulk bar. Dark:
  `rgba(36,44,38,0.62)`; light: `rgba(252,251,246,0.60)`.
- **Glass Edge** (`{colors.glass-edge}`): the 1px lit rim that gives the panel its edge.
- Blur 24px at 150% saturation for chrome; 18–20px at 160% for menus and sheets,
  so what passes under stays legible as colour and shape. One wide shadow
  (`--shadow-float`; `--shadow-dock` on the dock). The edge and the shadow are one
  declaration; a glass panel never adds a second border or a ghost card.

**The Scrim Is Not a Colour Rule.** An overlay scrim is the page itself, blurred and
slightly dimmed. It never adds a coloured wash; a tint over the green ground reads as a
flat plate and cheapens the glass.

**The Glass Is Chrome Rule.** Glass is allowed on navigation, headers, toolbars,
overlays, menus, toasts and floating actions. It is never the ground of a table cell, a
record body, a property grid, a form, or any text the user is reading or editing. A
surface that holds data is opaque. When the browser cannot blur, the fill goes opaque
and the edge stays.

**The One Light Rule.** The gradient exists to give the glass something to refract. It
is a wash on the canvas, not a panel: no stripes, no grain, no image, no second
gradient on a component.

### The tint and the accent
- **Accent Wash** (`{colors.accent-wash}`): the only tint, 12% of the chosen accent. It
  marks selection, the active destination, the search match and drag.
- **Accent Wash Hover** (`{colors.accent-wash-hover}`): the same tint one step up, 24%,
  for a hover or focus that must be seen: a card pane under the pointer and a menu row.
  It is derived from the accent, so all six accents and every space accent follow.
- **Accent on Wash** (`{colors.accent-on-wash}`): accent as text on the wash. Dark uses
  the accent itself; light darkens it so all six clear 4.5:1 over the wash on every
  surface. Lichen's light on-wash is `#525f18`.
- **Accent** (`{colors.accent}`): focus rings, the primary pill, the active glyph and the
  capture circle. At full strength it is text, a glyph or one small action surface.

### Semantic
- **Ember** (`{colors.danger}`): validation errors and destructive intent; text only.
- **Amber** (`{colors.warning}`): degraded connection state, never decoration.

### Highlight accent
The accent is a property of the space: an owner chooses one of six palettes in **Space
settings > Appearance**, and every member's open client applies it live through
`space.updated`. Editors and viewers see the current preset with its radios disabled.
The value lives in `space.yml` under the optional `accent` key (schema 4) and is written
through the owner-only `PATCH /api/spaces/{space}`. An unknown id or a hex value is a
`422` field `accent`; a hand-edited unknown value renders as Lichen.

| id | label | dark accent | dark ink | dark wash | light accent | light ink | light wash |
|---|---|---|---|---|---|---|---|
| `lichen` | Lichen | `#c8d96b` | `#14180f` | `#c8d96b1e` | `#5f6f1e` | `#f7f8f0` | `#5f6f1e1e` |
| `yellow` | Yellow | `#f2d64b` | `#1a1503` | `#f2d64b1e` | `#6f5d00` | `#fbf9ea` | `#6f5d001e` |
| `orange` | Orange | `#f5a24a` | `#1c1204` | `#f5a24a1e` | `#9a4a00` | `#fdf6ee` | `#9a4a001e` |
| `cyan` | Cyan | `#6fdbe8` | `#04181a` | `#6fdbe81e` | `#00646e` | `#eefcfe` | `#00646e1e` |
| `green` | Green | `#7fe08a` | `#051706` | `#7fe08a1e` | `#256b33` | `#f0fbf2` | `#256b331e` |
| `pink` | Pink | `#f49ac1` | `#1d0711` | `#f49ac11e` | `#96325f` | `#fdf1f6` | `#96325f1e` |

`web/src/lib/accent.ts` is the single source for the picker and the contrast test; the
core's `accent.rs` owns the ids the API accepts, and `globals.css` mirrors the palettes
as `:root[data-accent=…]` overrides of `--color-accent`, `--color-accent-ink`,
`--color-accent-on-wash` and `--color-accent-wash`.

**The Shared Accent Rule.** The accent is one shared property of a space, not a
per-person skin. One owner sets it; every member sees the same state colour.

**The One Accent Rule.** The accent marks state and one primary action. It never fills a
large area, never appears twice in a row for two meanings, and never becomes a second
accent. The 12% wash is the only permitted fill; at full strength it is text, a glyph or
the capture circle.

**The Light Is the Same Instrument Rule.** Light mode is not a skin. It swaps the ground
to bone, the glass to white and darkens the accent for contrast; it keeps every radius,
rule, type role and composition.

## Typography

**Display Font:** Maple Mono (fallbacks: ui-monospace, SFMono-Regular)
**Body Font:** IBM Plex Sans Variable
**Label/Mono Font:** Maple Mono

**Character:** One technical face carries the voice: the wordmark, space name, page
title, record title and every identifier, measurement, count and label. IBM Plex Sans
carries every sentence. The result reads as a specimen sheet typed on an instrument.
The web build ships upstream Maple Mono (`@fontsource/maple-mono`), not the Nerd Font
patch, because Lucide draws every pictogram.

### Hierarchy
- **Display** (400, 36px/1.05, -0.03em, mono): the space name, auth and page titles, one
  per screen. Phone: 30px/1.08.
- **Title** (400, 26px/1.1, -0.02em, mono): a record title and a type page's name.
  Phone: 22px/1.15.
- **Heading** (500, 18px/1.35, sans): section headings such as "Properties", "Body",
  "Identity".
- **Body** (400, 15px/1.6, sans): prose and form values; reading measure 65–75ch.
- **Small** (400, 13px/1.5, sans): secondary rows, hints, metadata sentences, errors.
- **Label** (500, 11px/1.5, 0.09em, uppercase, mono): column headers, field labels,
  roles, keys.
- **Data** (400–500, 12px, mono): ids, timestamps, counts; tabular numerals.

**The Mono Is a Voice Rule.** Maple Mono sets display and page titles, the record title
and one pull-quote or empty-state line per surface, at 400 with negative tracking. Body,
controls, tables and prose stay sans. A monospaced paragraph is a defect.

**The Ligatures Stay Home Rule.** The display role sets
`font-variant-ligatures: none`; a title shows the characters it was given.

**The Keys Are Mono Rule.** Identifiers and measurements are mono and tabular;
sentences are sans. The 11px label floor holds: no functional text below 11px.

Coarse pointers raise every input to at least 16px and every control to at least
44 × 44px.

## Layout

The shell floats: an app header inset 8–12px from the top and sides, 64px tall, a
full pill on a phone and 20px rounded from `lg`. Below `lg` it scrolls with the page, so
a phone — and a phone on its side in particular — spends no fixed height on chrome; from
`lg` it sticks while the page scrolls under it. From `lg` the space rail is a glass card
inset from the content edge, sticky under the header. It folds to its icons on request:
208px wide by default, 72px folded, with one 44px control in the rail's header row.
Folded, the space switcher is the current icon over the native select, every row is a
44px icon target, names stay in the accessibility tree and in tooltips, and the type list
carries its name and count in the tooltip. The choice is per reader and space; the phone
dock never folds. Width moves over 180ms on a fast-out curve and stops under reduced motion. The content
column is capped at 1400px with 16px side padding on a phone and 32px on a wide screen.

On a phone the dock is a 68px glass pill inset 8px, 12px above the home indicator. It has
three cells: the space destination on one outer edge, a 56px accent capture circle in the
middle, and search on the other. Handedness swaps the outer cells; the raised centre does
not move across a page.

**The Cover Sheet.** A space is a masthead and cards: the icon in a 72px glass tile with
a ~40px glyph and a 22px radius, the name at display size, a factual summary line, two
pill actions; a matte card holding the keyed type ledger; a glass activity card in the
4/12 margin at `xl` (below the ledger under `xl`); a matte graph card under the body; a
colophon line. Cards are siblings with a 16–24px gap, never nested.

The page ends on one footer rule. A page contributes its own line to the shell's footer
through `usePageFooter` — the cover puts its file-backed colophon there, beside the
changelog link and version — rather than printing a second `<footer>` above it.

A ledger row names its type once. The mono key appears only when it differs from
`keyFromName(name)` — a key minted from the name says nothing the name has not said, and
it is the schema page, not the cover, that teaches it. The count is generic (`4 records`),
never the type's own plural, for the same reason. A type page's masthead follows the same
rule: the key hangs beside the display name only when it differs from `keyFromName(name)`.

A record's folio deliberately keeps `PLANT · REV 1` even when the key merely spells the
name. There the key is the wiki-link spelling — the word an editor types to link to this
record — and the revision dates the sheet; the folio is disclosure for the id, not a
ledger row naming a type twice.

A type or record without an emoji icon shows its first letter in the display face in the
same icon slot, so two iconless types never render the same anonymous glyph; the neutral
box remains only where no name is available.

The space map offers one view control of its own beside the zoom cluster: a titles toggle,
`aria-pressed`, persisted per reader and per space. Titles on, a phone draws and names the
five best-connected records; titles off, it draws every record as a dot, because the shape
is what the hidden names leave room for.

**The Record Sheet.** One matte card at 24px radius. Inside: an identity band, the
schedule strip, a body section, links and history. The 4/12 property margin is a
divided column — a left rule and padding at `xl`, a top rule and padding below it — not
a second card. The clean `Saved` seal is a small glass pill in the identity band. While
dirty, one glass action row sticks above the dock on a phone; from `lg` the identity band
carries the unsaved count and Save.

**The Cover Hero.** A record's cover opens the card inside its padding: a 16:9 image in a
16px inner frame with one hairline, `object-fit: cover`, above the identity band. The
hero is the card's first element and nothing sits over it; the identity band keeps its
own spacing below. Change and Remove live in the record's overflow menu, so the picture
never carries chrome over it. Repositioning trades the hero for the same frame with a
crosshair cursor and the stored centre marked; a click on the picture and the two sliders
below move it, Center returns it to 50% 50%, and Cancel and Done close the editor. The
preview draws the same `object-position` as the gallery tile, so the framing is chosen
where it is seen. The copy is plain: Change cover, Remove cover, Reposition, Center.
An absent cover leaves the card at the identity band; there is no empty placeholder
frame.

**The Attachments Field.** A set of files is one control: a bordered frame holding a
square thumbnail grid for images and a full-width row for every other file, in upload
order. Each image tile carries its own remove control, and the record page offers
`Set as cover` on a tile that is not already the cover; the current cover wears a
`Cover` chip instead, so the target is never ambiguous. `Add files` opens a multiple
picker and the frame also accepts a drop; `Paste` reads the clipboard and refuses with
one sentence rather than failing silently. A thumbnail opens the one lightbox over the
set, at the tile that was touched. In a table cell the same field stages its edits and
commits the whole list once, on `Done`.

**The Lightbox.** One image overlay, and it is the sheet language rather than a second
modal: the ground is the page's own scrim, the picture is bounded by the viewport with its
caption in the sheet header, and the close control follows the pointer floor — 36px on a
fine pointer, 44px when coarse. When the opener passes a set of pictures, the header carries
a previous and next control that wrap at either end and a mono `n / count` counter beside
them, and the arrow keys step the same set. Escape closes it, focus returns to the image that
opened it, and the page behind does not scroll. A file value is not an image: it downloads,
and never opens this overlay.

**The Ledger Table.** A type page is one glass panel above one matte ledger. The type
masthead, the saved views and the search/Columns/Sort/Filter tools float together as the
page's chrome; it scrolls with the page and never parks over the ledger's own column
labels. The table itself lives in a 20px matte card with one border. It has two fills and
no third: a raised band for the whole header row — Title and the checkbox cell included —
and the card's surface for every body cell, the checkbox column and both action rails
included. A pinned column keeps its rule and never changes fill to prove it is pinned.
The band is a lid over the card, not a second surface; the selection and hover washes
overlay both band and body. The card clips the table; the table scrolls inside it. The
page's tools — Columns, Sort and Filter — share one full-width frosted surface under the
chrome, each section separated by space rather than a rule; a column's position is one
pill with a number and a pair of arrows, so the first and last slots show a disabled end.
View settings and the CSV panel are page editors, not ledger content: they open the same
centred glass dialog as the other overlays instead of an inline band that pushes the
table down. The view tabs are a recessed segmented track with the active
segment on the accent wash. The strip closes the panel, sitting below the search and tools on the
container's bottom edge, so a view is chosen where the views meet the records. Its two
edge actions are 36 px circles (44 px coarse) on the accent wash: Reorder on the
non-dominant edge, New view on the dominant one, with the selector centred between them;
`ThumbRow` swaps the edges for left-handed mode while the selector stays in the middle. A
tool's trigger carries the accent wash while its panel is open. Filter and sort panels are
glass.

**The Property Identity Rule.** A property is named by its accent-coloured title and a
format pill — a mono, pill-shaped marker on the 12% accent wash with the accent edge. The
capture sheet's other fields, the record's property margin, the schema property list and a
type's member list share it; the record title and the ledger stay ink. In a ledger the
accent marks state — the sorted arrow, the active row, the selection — never the column
label: a header is muted at rest, ink when its column is sorted, and the format key stays
faint mono. In a property row the title leads and the pill trails, the same as the capture
sheet's other fields; a ledger column header stacks the pill under its label because the
column is narrow, and on a phone the ledger drops the pill entirely. The capture sheet's
icon trigger takes the same accent frame, and its `Type` label is accent.

**The Cell Editor Rule.** A cell edits in place for text, number, date, datetime, URL,
email and checkbox — the field is smaller than the cell. Select, multi-select, relation
and recurrence need more room and always float: a popover anchored to the cell on a fine
pointer, one sheet on a phone, both opening the same editor body. The cell keeps a
one-line chip while the overlay is open, so the row never grows. The popover is one shell
— glass-strong, a `--color-line-strong` edge (never an accent border), at least 13rem and
the cell's width, at most 22rem and the space the viewport gives it, with its list
scrolling inside and `4px` from the cell, flipping rather than leaving the viewport. It is
portalled, so the card's scrollport and the sticky columns cannot clip or cover it.
Escape cancels and returns focus to the cell in every case. A phone's sheet carries the
property title and record title in its header.

**The Writing Surface.** The body editor is one glass shell: its top row holds the
formatting tools and the Write/Preview switch, and the writing well below it is an opaque
matte inner surface, so prose never sits under a blur. The tools and the switch are
separate parents — the switch is a segmented track on the dominant edge — so the nine
tools keep their own symmetry. On a phone the tools keep two centred rows in their own
parent and the switch sits in a second centred parent beside them, the pair spaced with
`space-around` (five then four tools); a phone too narrow to hold both wraps the switch
beneath the tools. In preview mode the switch stays on the dominant edge alone. From `sm`
the tools take one row and the switch sits at the far end of the shell. While a phone writes, the surface's header is
its own glass pill with `Writing`, `Done` and a separate primary `Save`; Save never sits
among the formatting tools. The toolbar's hover, focus, disabled and coarse-pointer states
are the shared button states. The `/` command list and the `[[` link list are one
`glass-strong` panel with the active row on the accent wash, the same surface as the
command palette.

**The Calendars.** The Schedule's Calendar and a type's Calendar are the same matte card
with the same month controls, weekday rule, chip cap and glass day panel. A chip carries
the record's name only, so a narrow cell never trades its title for a hover-only control;
the day number opens the day panel on every pointer, and a row there reads title first,
with its date and due phrase in mono, plus complete and menu actions. Every visible date
— chip, day panel, empty state — comes from the shared formatter.

**The Tiles.** A gallery tile is matte at the card radius (18px); its tinted cover is
clipped by that corner, never a square band over a rounded frame. When the view names an
image property or a photo set, or the record carries a cover, that image fills the same clipped frame at
16:9 with the record's stored focal point; the tint remains the fallback. The tile asks for
the 512px derived copy, holds a neutral matte while it loads, and never stretches the
original into the frame; the full bytes are the lightbox's business. The complete and
menu actions on a board card, gallery tile or calendar chip are 32px frosted circles — 44px on
a coarse pointer. On a matte surface the pane is a real piece of glass — the glass fill with a
trace of the space's own colour mixed in, the lit rim and a blur near its own size, with the
space accent on the glyph. On a cover the fill
is dropped — an ink wash over a picture reads as one flat plate and hides it — so the picture
is the material and the glyph carries the contrast: a light mark with a dark halo, which holds
on a bright sky and a dark leaf alike. Under the pointer either pane takes the accent wash
hover, the space's own colour one step up, laid over whichever body it has. The menu a kebab
opens washes the neutral ground behind its own blur, never the green glass, because a cover can
sit behind it. An image opens the
one lightbox: the picture at reading size, its caption, Escape and focus back on the tile.

**Quiet surfaces.** Schema, members, settings, trash, auth and account settings share one
page header and one section rhythm. Sections are matte cards at 22px; the danger section
carries an Ember edge. The signed-out screen is a glass top bar, the form, and a glass
margin panel explaining the file-backed model.

Spacing uses one 4px scale: `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16,
`--space-5` 24, `--space-6` 32, `--space-7` 48, `--space-8` 64. Tight groups use 4–8px,
a label group 8px, fields 16px, sections 32px, page bands 48–64px. More space above a
heading than below it.

## Materials and elevation

| Material | Fill | Edge | Depth | Where |
|---|---|---|---|---|
| Glass | `--color-glass` | `--color-glass-edge` | blur 24px, saturate 150%, `--shadow-float` | header, rail, dock, menus, save row, bulk bar |
| Glass strong | `--color-glass-strong` | same | blur 18–20px, saturate 160%, `--shadow-float` | sheets, palette, menus, toasts |
| Matte card | `--color-surface` | `--color-line` | none | ledger card, record sheet, table card, sections |
| Field | `--color-raised` at 40% | `--color-line-interactive` at 70% | none | every input, select and textarea |
| Inset band | `--color-inset` | none | none | table header, recessed code |

**The Edge or the Cards Rule.** A matte card declares one hairline and no shadow. A glass
panel declares one lit edge and one ambient shadow. Never both a wide shadow and a drawn
card border on the same matte surface.

**The Radius Family Rule.** Pills (`999px`) are only for actions, segments, chips, the
dock and status seals. Inputs and small wells use 12px; cards 18–22px; the record 24px;
sheets 28px. A single control never mixes corners.

## Controls and states

- **Button.** Pill, 40px at rest and 44px on a coarse pointer. Primary is the accent fill
  with accent ink and a soft neutral drop; ghost is a translucent raised fill with a field
  edge; quiet is a glyph or a word with no frame until hover; destructive is Ember text
  and edge. Every button has hover, active, focus-visible, disabled and loading states.
- **Icon button.** A 40px circle (44px coarse). `glass` carries the frosted fill and lit
  edge; `quiet` is a bare glyph; `accent` is the capture circle. Active adds the accent
  wash and accent-on-wash text.
- **Field.** 12px corners, translucent raised fill, 70% field edge, accent focus border
  plus a 2px accent ring at 3px offset. Placeholder is faint. Invalid is Ember in both
  border and message.
- **Segmented control.** A pill track on a translucent surface with a 4px inset; the
  active segment is a pill on the accent wash, never a sliding animation the user must
  wait for.
- **Menu and popover.** Glass-strong panel at 18px, 6px inset, 10px rows, the accent wash
  hover on the highlighted row. The trigger is a pill with a field edge. The menu a card
  pane opens is the exception: it washes the neutral ground at 62% so a cover behind it
  cannot take the text away.
- **Sheet and dialog.** One glass-strong panel at 28px, a 20px blur, and a scrim that only
  blurs 5px and dims to 90% (96% in light) — no colour fill, so the page stays
  recognisable around and under the material, a 240ms rise from 18px, one close control (a 36px circle, 44px
  coarse) on the handed edge. The phone sheet floats 8px from the side and bottom edges.
- **Toast.** Glass-strong at 18px with a mono action; the stack sits above the dock.

**Every State Is Visible.** Hover, focus-visible, active, selected, disabled, loading,
empty, error and read-only are defined once in `components/ui/controls.tsx`,
`components/ui/sheet.tsx` and `components/ui/toast.tsx`. No page defines its own button
or input. A control with no focus-visible replacement is a defect.

## Motion

One ease (`--ease-out`, `cubic-bezier(0.16, 1, 0.3, 1)`), three durations (120, 180,
240ms). Sheets rise 18px with their glass already in place — never a fade, which would
let the frosted face arrive after the panel; popovers fade with a 6px rise; palette
results fade and move 4px; toasts rise 6px; the dock's active seal changes colour, never
geometry.
Nothing animates layout, table rows, prose or scroll. Under
`prefers-reduced-motion: reduce` every entrance is instant and colour feedback stays.

## Handedness

Reading order never moves: page headers, prose, table columns, graph nodes and settings
rows never mirror. Thumb actions do: dialog and sheet closes, action rows, the save row
and the dock's outer destinations. `ThumbRow` moves the primary action inside its own
row. The dock's capture circle stays centred in both modes.

## Accessibility and inclusion

The contrast floor is 4.5:1 for body and metadata text on the ground, the four matte
steps, the accent wash and the glass composite at the lightest point of the gradient.
`lib/accent.test.ts` enforces the accent, on-wash, ink-on-wash and glass pairings. Focus
is always visible with a 2px accent ring at 3px offset. Every icon-only control has an
accessible name. The 11px label floor, the 44px coarse target and the 16px coarse input
are non-negotiable. Any state shown by colour is also legible as text or a shape.

## Don'ts

- **Don't** blur a table, a record body, a property grid, a form or prose.
- **Don't** put a glass panel inside another glass panel; nested cards are a defect.
- **Don't** add a second accent, a gradient to a component, a neon glow or a decorative
  halo. The only gradient is the page's top light.
- **Don't** use glass as a way to avoid choosing a layout; every glass surface has one
  job and one edge.
- **Don't** animate layout, tables or prose; only transform, opacity, colour and the
  sheet's rise explain a change.
- **Don't** turn the product into a travel app: no photographic covers, mascots,
  illustrated empty states or playful colour.
- **Don't** replace the type voice: Maple Mono and IBM Plex Sans stay.

## Surface record

Every signed-in surface consumes the foundation: the floating header and rail; the phone
dock and space sheet; the cover sheet; the record sheet and its save row; the ledger
table, view tabs, filter/sort bars and bulk bar; the command palette, capture, shortcuts,
sign-out and icon sheets; the schedule list and calendar; schema, members, settings,
trash, account settings, auth, join, changelog and not-found. The shell owns the one
footer rule; a page's line joins it through `usePageFooter`. The accent picker and the
file-backed colophon are unchanged in meaning.
