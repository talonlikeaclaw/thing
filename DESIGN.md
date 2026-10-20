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
- **App header:** 64px tall, hairline bottom rule, wordmark at left, account email and a ghost
  "Sign out" at right. No sidebar in the signed-out surface; the space list is the navigation.
- **Wordmark:** mono "thing" with a 10px lichen square. It is the only decorative use of the accent.

### Space Index Entry
- **Shape:** a full-width row separated by hairlines, never a card.
- **Key:** the last six characters of the space UUID, uppercase mono 11px. It is a button that
  toggles the entry's annotation (`aria-expanded`, `aria-controls`).
- **Name:** 17px medium sans with the user's emoji icon, linked to the space.
- **Counts:** tabular mono 11px, right-aligned under MEMBERS and TYPES headers.
- **Role:** uppercase mono 11px, right-aligned.
- **Annotation:** opens directly beneath the row as a 5rem/1fr definition list in mono 12px, with a
  single hairline left border. It carries the full id, member count and type count.

## Do's and Don'ts

### Do:
- **Do** keep the accent to state and the wordmark; if it is not saying "selected", "focused" or
  "primary action", it is the wrong color.
- **Do** use mono for keys, ids, counts, timestamps and labels, and tabular numerals for every number.
- **Do** separate rows and sections with 1px hairlines and spacing, not cards or shadows.
- **Do** name the next action in empty states and errors, in the product's own language.
- **Do** keep the signed-out margin notes factual: they describe what the files and schema are.

### Don't:
- **Don't** introduce shadows, glass, gradients, glows or colored side stripes.
- **Don't** fill large surfaces with lichen or introduce a second accent.
- **Don't** use emoji as interface icons; they belong only to user-authored space icons.
- **Don't** turn the index into a card grid, add a sidebar before the space exists, or hide the
  create action behind a modal.
- **Don't** set prose in mono or identifiers in sans.
