---
target: web/src/pages/type-table.tsx
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 5
target_identity: "file:/home/talon/Code/active/thing/web/src/pages/type-table.tsx"
target_fingerprint: "sha256:01ff8d2c4cf92c1abf06b0c9b169d992c7c0c91233ec570f43f667d0d9d6a722"
target_path: /home/talon/Code/active/thing/web/src/pages/type-table.tsx
timestamp: 2026-10-26T16-55-50Z
slug: web-src-pages-type-table-tsx
---
# Mobile critique — primary interaction pages (v0.4.2 baseline)

Method: dual-agent (A: AssessmentA design review · B: source + detector + browser measurements,
run in the parent after the B sub-agent had no exec/browser; see Run Notes).

Evidence: seeded Garden space served by `thing-server` with the production SPA bundle; headless
Chromium 390x844 with touch emulation; `impeccable detect --json` over `web/src` (no output: the
scanner reads markup, not TSX) and `detect --cdp` against the authenticated page (7 findings).

## Design Health Score (phone, 390x844)

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | connection status hidden below `sm`; `SAVED` shown before any edit; palette result count under the keyboard |
| 2 | Match System / Real World | 3 | Excel model lands; "Schema" vs "Types and properties"; "Done" vs "Complete" |
| 3 | User Control and Freedom | 3 | undo/Escape everywhere; record's only back is a 12px crumb |
| 4 | Consistency and Standards | 2 | two filled primaries per page; 36px actions where DESIGN says 44; 70vh vs dvh |
| 5 | Error Prevention | 3 | 409 recovery, dirty guard, typed confirmations; destructive Complete beside the title |
| 6 | Recognition Rather Than Recall | 2 | bare "+", icon-only kebab, icon-only Account/Sign out, counts hidden on type rows |
| 7 | Flexibility and Efficiency | 2 | palette does not raise the keyboard; multi-select is a mode, not a gesture |
| 8 | Aesthetic and Minimalist | 2 | four toolbar rows before the first record at 390 |
| 9 | Error Recovery | 3 | inline alerts, Retry, failed rows stay selected |
| 10 | Help and Documentation | 2 | onboarding only in an empty space; mobile guidance is one 11px sentence |
| **Total** | | **24/40** | Acceptable — significant work needed |

## Specificity

The keyed table header is unmistakably this product. At 390 the record and settings surfaces are
label-over-field forms carrying a mono key that repeats the label - echo, not information. The one
distinctive move, the keyed index, is what the phone layout discards first.

## Priority issues

[P1] Palette/capture are not keyboard-aware: focus from a passive effect; `fixed inset-0` +
`max-h-85dvh` ignoring the visual viewport; no `interactive-widget`; no `visualViewport` anywhere.
[P1] Phone type page opens with zero records above the bar; four toolbar rows.
[P1] Table width model: preview uses unscaled px while neighbours are scaled; measured +72px jump on
a +30px drag and an 86px snap back on release; a 100px drag nets +56px.
[P1] Phone table: 80px property columns (~44px of text), unpinned title, escaped title resizer at
page x=714, sticky action rail with z-index auto.
[P1] Record title clipped; UUID + REV + third mono line before the content; key echo per field.
[P2] 16 safe-area uses all resolve to 0 (`viewport-fit=cover` absent).
[P2] Sub-44px targets and sub-16px inputs (12px sort/filter selects, 14px emoji search, 36px actions).
[P2] Detector: 9px functional mono keys in five header cells.
[P3] Paging footer on single-page tables; `+ New view` is a bare "+"; cream-palette false positive.

## Personas

Alex: resize never yields the dragged width; Duplicate disabled with the reason only in a title
tooltip; palette searches titles only.
Jordan (phone first-timer): controls before data at 390; two unlabelled header squares; reads the
type page as empty.
Priya (self-hosting owner): no connection state below `sm`; no external-change signal on a record
until a 409; the "markdown on disk" footer is pushed under the bottom bar.

## Run Notes

- Assessment A produced the design review from source + prior captures.
- Assessment B ran in the parent: the detached B agent had no shell or browser, so the detector and
  all DOM measurements were run by the orchestrator against the live seeded instance.
- Detector: `detect --json web/src` returned `[]` (TSX not scanned); `detect --cdp --target plant`
  returned 7 findings, of which `cream-palette` is a verified false positive.
- Touch layout was emulated; no physical device was exercised.
