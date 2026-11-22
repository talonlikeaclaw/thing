# Handedness audit — every interaction surface

Run on 2026-11-22 against the working tree (v0.9.0 plus the uncommitted M9 work) in the live dev
SPA and in the jsdom suite. The audit asked one question of every interactive surface: does it obey
the browser-local left/right preference, and does it obey it in the DOM rather than by painting a
second order?

**Normative sources:** `DESIGN.md` §Handedness (below `lg` the thumb action sits on the chosen edge;
reading order never moves; `ThumbRow` reverses the DOM so paint, Tab and screen-reader order agree;
the preference is inert from `lg`) and `docs/plan/m4.5-schedule-views.md` §3 (the surface list and
the ban on CSS-only reversal).

## Method

- Source audit of every component and page that renders an action row, row/card menu, popover
  anchor, sheet header, save row or toast, plus the primitives in `components/handedness.tsx`,
  `components/ui/sheet.tsx`, `components/ui/controls.tsx`, `components/ui/page.tsx` and
  `styles/globals.css`.
- Live pass in the shared Chromium profile against the running dev server, signed in as the seeded
  owner. Viewports `390 × 844` (mobile/touch emulation) and `1440 × 900`; both handedness values set
  through the browser-local key. Surfaces measured after paint; screenshots inspected but not
  stored. The coarse-pointer media feature was not separately asserted in this pass; the audited
  placement paths read width only.
- The whole web gate: `npm run typecheck`, `npm run lint`, `npm run test:run`.

## Findings and fixes

### Action rows that mirrored by CSS only

`flex-row-reverse` / `order-*` changes paint but not DOM order, so Tab and a screen reader keep the
right-handed sequence. Each is now a `ThumbRow` (nested where the row has a second action cluster),
which reverses the DOM itself.

| Surface | File | Fix |
|---|---|---|
| Record header identity band | `components/object-panel.tsx:1189` | Reversal removed: a page header stays `[identity, actions]` in both modes, per the v0.5.2 precedent |
| Body section heading + Revert | `components/object-panel.tsx:1518` | Reversal removed (reading-order heading) |
| Attachment file row | `components/attachment-field.tsx:274` | `ThumbRow` around content + `AttachmentMenu` |
| Single file field | `components/file-field.tsx:141` | Outer and action cluster are `ThumbRow`s; the false “reversed DOM order” comment corrected |
| Icon picker custom field + Use | `components/icon-picker.tsx:356` | `ThumbRow` |
| Snooze days form | `components/agenda/snooze-menu.tsx:163` | `ThumbRow` inside the form |
| Editor toolbar + mode switch | `components/markdown-editor.tsx:920` | `ThumbRow` |
| Bulk panel heading + Apply | `components/bulk-bar.tsx:317` | `ThumbRow` |
| Compact status band + Reset/Save | `components/type-table.tsx:921` | Nested `ThumbRow`s |
| Pagination range + Prev/Next | `components/type-table.tsx:1329` | Nested `ThumbRow`s |
| View label + tools, compact status | `components/type-table.tsx:985` | `ThumbRow`; the tool cluster now reaches the chosen edge instead of staying right-flush |
| Schedule page header | `pages/agenda.tsx:247` | Reversal removed; the List/Calendar switch is navigation and keeps reading order |
| Member row role/Remove | `pages/members.tsx:184` | `order-first` removed; a settings row never mirrors |
| Library card footer | `pages/library.tsx:347` | `ThumbRow` |
| Library record chips | `pages/library.tsx:378` | `ThumbRow` removed; chips never mirror |
| Trash bulk actions | `pages/trash.tsx:315` | Inner cluster is a `ThumbRow`; safe Restore reaches the thumb edge |
| Trash row actions | `pages/trash.tsx:459` | `md:justify-end` dropped; it defeated the hand from 768–1023 px |
| Month label + prev/Today/next | `components/views/month-grid.tsx:183` | Reversal removed; month controls keep reading order |
| Calendar day-panel close | `components/views/month-grid.tsx:346` | Conditional DOM order: close first in left mode, last in right |
| Recurrence form row | `components/recurrence-input.tsx:45` | Dead handedness branch removed; the row is a form, not an action row |

### Missing handedness handling

| Surface | File | Fix |
|---|---|---|
| Attachment menu anchor | `components/attachment-menu.tsx:55` | `align` flips to the thumb edge (`start` left / `end` right); it previously centred in both modes |
| Promote-column sheet | `components/schema/promote-column.tsx:224` | Close first in left mode, matching every other sheet |
| Promote-column footer | `components/schema/promote-column.tsx:575` | `ThumbRow`; canonical order restored (Cancel/Back/Close first, Preview/Create/Retry last) |
| Add-property footer | `components/add-property.tsx:807` | `ThumbRow`; the format chip leads as status, then Cancel, then the primary |
| Manage-properties search row | `components/manage-properties.tsx:163` | `ThumbRow`; Add property reaches the thumb edge |
| Sort rule row | `components/sort-bar.tsx:83` | Picker + Remove wrapped in `ThumbRow`; the ordinal still leads the row |
| Missing-member row | `components/property-field.tsx:791` | `ThumbRow` around the warning and Remove |
| CSV chooser row | `components/views/data-panel.tsx:221` | `ThumbRow`; Clear is the far end from the thumb, Choose the primary |
| Sign-out confirmation | `components/sign-out-dialog.tsx:70` | Children swapped: the safe Cancel now owns the thumb edge |
| Invite row | `pages/members.tsx:429` | Outer and Copy/Revoke clusters are `ThumbRow`s; Copy takes the thumb edge |
| Settings identity save row | `pages/settings.tsx:242` | The only child was a Fragment, which `Children.toArray` does not flatten, so the row never reversed; status and Save are now sibling children |
| Settings storage row | `pages/settings.tsx:382` | Hint precedes the button, so `Collect unused` owns the thumb edge |
| Type-table compact status | `components/type-table.tsx:921` | See above; also fixes the previously inert inner pair |

### Primitive and width gating

- **Toasts mirrored on the desktop.** `:root[data-hand="left"] .toast-stack` was the only CSS
  consumer of the root attribute and applied at every width while every React surface is canonical
  from `lg`. The rule is now scoped to `max-width: 63.99rem`, so a left-handed desktop keeps the
  stack at its trailing corner. Measured live at 1440 with the preference set to left: the stack sat
  at `left 1040 / right 1424`, not the left edge.
- **Account copy.** `pages/user-settings.tsx:84` now says the movement happens “on a phone”, which is
  what the width gating does.
- **Contract test.** `components/handedness.test.tsx` asserts the `ThumbRow` contract directly:
  reversed DOM and leading primary in left mode on a phone, canonical order and trailing edge in
  right mode, and canonical order from `lg` regardless of preference.

## Intentionally unchanged

- **Settings rows, headings, table columns, graph nodes, chips and the view tab strip** never
  mirror. The summary-band checkbox, links/history rows, page titles and saved-view navigation keep
  their order in both modes.
- **Schedule List compact rows** keep the sanctioned grid flip that moves the action cell while the
  link stays the row's first Tab stop (`docs/plan/m4.5:241`).
- **Desktop-only popovers** (`choice-picker`, `property-picker`, `view-panel`'s fine-pointer branch)
  keep `align="start"`; they only render where the preference is inert.
- **`schema.tsx` compact tablist alignment** moves the navigation group's side but never its order;
  it is alignment, not a mirror.
- **Snooze days and recurrence forms** keep the label leading its fields; only their submit row
  follows the thumb.

## Verification

- `npm run typecheck`, `npm run lint`, `npm run test:run`: clean; 80 files, 823 tests.
- Live, left-handed at 390: record actions `New plant, Properties, Edit type`; View row
  `[tools, View]` with Filter outermost; add-property close at `x 13` and footer
  `Add to table` before `Cancel`; sign-out `Cancel` before `Sign out`; day-panel close at the
  panel's leading edge; month label still leading its navigation.
- Live, right-handed at 390: the same rows in canonical order (`Edit type … New plant`,
  `View … Filter`, `Create and open … Create`).
- The dev browser's preference was removed after the pass; no data was written.
