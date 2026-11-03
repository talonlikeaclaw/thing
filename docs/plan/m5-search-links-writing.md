# Milestone 5 — search, links and the writing surface

**Status: LANDED 2026-11-02 at workspace `0.5.0`.** M1 is deployed as `v0.1.0`; M2–M5 are
implemented on the tree (`0.2.0`–`0.5.0`), with the v0.4.3 physical-iPhone keyboard gate still open.
Nothing here re-opens a locked decision in `docs/ROADMAP.md`.

**Scoping note, recorded now.** M5 adds one derived structure (an inverted index), one API read (search)
and one API extension (links and mentions on a record), plus body-syntax parsing and a richer editor
(toolbar, shortcuts, a `/` command menu, live preview). It does **not** change the on-disk format:
`FORMAT_VERSION` stays `4`, no frontmatter key is added, and a wiki link is body text, not a stored
relation value. It adds **no dependency**: `react-markdown` and `remark-gfm` already render the body,
and the graph is plain SVG.

The search index is **in memory, derived from the markdown** — built at boot and updated per changed
file, never written beside the space. The roadmap's phrase "on-disk inverted index" is read as "an
index over what is on disk"; a sidecar index file would be a second copy of derived state that the
markdown already rebuilds cheaply, with its own staleness and write-amplification cost. That decision
is recorded again in §7 so the release checkpoint can correct the roadmap wording rather than leave
two descriptions of the shipped system.

## 1. Scope

In scope:

- **Search across a space.** One ranked read over every live record's title and body:
  `GET /api/spaces/{space}/search?q=…`, with an optional type filter, a bounded result page, a
  snippet from the body and deterministic ordering. Matching is token-based with prefix support;
  no query language, no operators, no fuzzy correction.
- **The palette uses it.** The command palette's bounded title lookup is replaced by the search
  read: a body-only match appears, the row shows the sentence around the match, and the copy stops
  promising titles only. Types, spaces and actions keep the client-side scorer.
- **`[[TypeKey/Title]]` wiki links.** Parsed out of the markdown body (never out of code), resolved
  against the space's live records, rendered as internal links, and surfaced when they no longer
  resolve. One grammar, one resolver.
- **Backlinks that include mentions.** A record's detail can carry its outgoing links and every
  record that points at it — through a relation property or through a wiki link — with the property
  name or the sentence for each.
- **A links panel on the record page.** Incoming relations and mentions, grouped and navigable, with
  a truthful empty state.
- **A local graph.** The record and its one-hop neighborhood as a deterministic SVG; no force
  simulation, no new dependency. A space-wide scope over the same edges ships in the same release.
- **A real writing surface.** A formatting toolbar, keyboard shortcuts, list continuation, list
  indentation, a live preview beside the editor on wide screens, and `[[` autocomplete that inserts
  a link whose target exists. A `/` menu at the start of a line applies the same formatting without
  a shortcut or a toolbar button, so a person who does not know markdown can type `/quote`. The
  source stays markdown in a plain textarea; there is no WYSIWYG HTML and no editor library.
- **Documentation and the release.** `AGENTS.md`, `docs/ROADMAP.md`, `DESIGN.md` where the body
  surface changed, the changelog, and workspace `0.5.0`.

Out of scope, deliberately:

- **No format or schema change.** `FORMAT_VERSION` stays `4`; no `links` frontmatter key, no new
  generated property, no new revision action. A wiki link is body syntax; the index and the API are
  derived. A schema-5 bump waits for a feature that actually writes new file fields.
- **No persisted search index file.** No `search/` directory, no SQLite table, no cache file. The
  index lives beside `SpaceIndex` in memory and is rebuilt from the files at boot; one object change
  updates one document. There is nothing to back up, migrate or invalidate.
- **No link rewriting on rename.** Renaming a record's title or a type's key leaves existing
  `[[…]]` text untouched. A link that no longer resolves is shown as unresolved; it is never
  silently re-pointed, and no other file is rewritten behind the user's back.
- **No duplicate-title disambiguation syntax.** A wiki link resolves only when exactly one live
  record matches the type and title. Two records with the same title make the link **ambiguous**,
  which the UI says out loud. A `#short-id` or alias grammar is a later decision, not a quiet rule.
- **No second graph endpoint or separate save.** The local and whole-space scopes read the record
  detail's existing links and backlinks; node offsets are view-only and never written.
- **No search page, saved searches, filters or operators.** Search is reached from the palette; it
  searches the current space only. On the spaces list there is no search read.
- **No table-search change.** The type table's `q` stays a per-type title/body substring filter with
  the server's saved view and sorts around it. It is a filter with a stable order; the palette is a
  ranked global read. They are different jobs and keep different semantics.
- **No semantic or fuzzy search.** Token matches, prefixes and case folding only. No stemming, no
  typo tolerance, no embeddings.
- **No collaborative editing, cursors, comments or WYSIWYG.** The textarea remains the editor; the
  preview is rendered markdown.
- **No attachments or images.** M6 owns files, covers and a file property.

Success is: on the seeded Garden space, typing a word that appears only in a Plant's body into
`⌘K` finds that record with a snippet around the word and opens it; typing `[[plant/Monstera]]` in a
Chore's body saves normally, renders as a link to that record, and puts the Chore in Monstera's links
panel and local graph; the toolbar and shortcuts format a selection without losing focus; typing
`/quote` at the start of a line turns that line into a quote without knowing the `>` prefix; a phone
keeps a usable editor and preview without the toolbar covering the keyboard; and no object file
gains a key it did not already have.

## 2. Starting state

What v0.5.0 builds on, so a new session does not re-derive it:

- **`SpaceIndex`** (`crates/core/src/index.rs`) holds `objects: BTreeMap<Uuid, ObjectDoc>`, per-type
  `summaries`, path maps and fingerprints, and is rebuilt from the store at boot
  (`rebuild_from_disk`) and updated file by file (`reload_file`). The server wraps it in a
  `RwLock` inside `SpaceHandle` (`crates/server/src/spaces.rs`); writes take `handle.write` and
  broadcast, and the watcher calls the same `reload_file`.
- **`ObjectDoc`** (`crates/core/src/model.rs`) carries `title`, `type_key`, `icon`, `properties`
  and `body`; the body is the markdown after the frontmatter and is serialized verbatim
  (`crates/core/src/markdown.rs`). A record write is one `PATCH` carrying title, icon, body and the
  changed property map.
- **Existing search is per type.** `routes/objects.rs::list` takes `q` and filters the type's
  summaries through `matches_text`, a case-insensitive substring test over the title and the
  lowercased body. There is no cross-type read and no ranking.
- **The palette is deliberately bounded.** `components/command-palette.tsx` fetches up to 100
  updated-desc rows per type through `usePaletteRecords` and ranks them client-side by title with
  `lib/search.ts::rank`. Its own doc comment says M5 replaces this with real search.
- **The body editor is a textarea with two modes.** `components/object-panel.tsx` owns `draft.body`,
  a Write/Preview toggle, a Revert control and the sticky save bar; write mode is a plain
  `<textarea aria-label="Markdown body">`, preview mode renders through
  `components/markdown-view.tsx` (`react-markdown` + `remark-gfm`, external links opened in a new
  tab). `components/history-panel.tsx` reuses `MarkdownView` for a revision's body.
- **Relations are properties.** A `relation` value is a target UUID or a list of them
  (`model::Value::Text` / `List`); `ObjectDetail` carries `missing_relations`; the detail route
  already accepts `?with=history,backlinks`, and `backlinks` is computed on demand by scanning
  every object's relation properties (`routes/objects.rs::backlinks`). No web code calls it yet.
- **There is no link parser, no title lookup and no graph.** Nothing in the body is interpreted
  beyond GFM; `[[…]]` renders as literal text.
- **Web tests** are `web/src/lib/*.test.ts` plus `api/client.test.ts`; server HTTP tests live in
  `crates/server/src/routes/mod.rs` with `Server::call`, `chore_space` and `day`. Core tests rely on
  fixture files and `tempfile::TempDir`.
- **Versions and docs.** `Cargo.toml` and `web/package.json` are `0.4.5`; the changelog is
  `web/src/content/changelog.ts`; `DESIGN.md` and `.impeccable/design.json` are normative for the
  record page; the delivery protocol is in `docs/ROADMAP.md` and `AGENTS.md`.

## 3. What the starting state does

Source-verified on 2026-11-01 against the landed v0.4.5 tree. Nothing below is inferred from a
mockup.

| # | Area | Now | Consequence |
|---|---|---|---|
| 1 | Cross-type search | No route; the palette reads at most 100 recent titles per type | A word that appears only in a body is unfindable from `⌘K`; a large space silently truncates |
| 2 | Ranking | Client subsequence score over titles | Results are ordered by title shape, not by where the query matched or how recent the record is |
| 3 | Body syntax | `[[Plant/Monstera]]` renders as literal text | There is no way to point from prose to a record |
| 4 | Backlinks | Route exists for relation properties only; no caller | The user cannot see what points at a record; wiki links would have no surface |
| 5 | Writing | Plain textarea; no toolbar, shortcuts, list continuation, preview beside the text or `/` menu | Formatting is typed by hand; `[[` is not discoverable |
| 6 | Graph | None | The space's shape is invisible beyond tables and views |
| 7 | Index | `SpaceIndex` holds documents but no token structure | Every search would either scan bodies per query or re-tokenize on demand |
| 8 | Object detail | `with=backlinks` returns relation rows only; `with` rejects anything else | A mentions shape and an outgoing-link shape must be added deliberately |

**Not findings** (verified and left alone): the object PATCH already replaces the body verbatim and
records it in history; `missing_relations` already surfaces a deleted target and is rendered by the
relation field; the record page remounts on `key={record.id}` so a draft cannot leak between
records; `markdown-view.tsx` already maps every element to the design tokens; `DESIGN.md`'s record
page already reserves space for the body and the sticky save bar.

## 4. The rules this patch follows

1. **The markdown is the source; the index is a projection.** Search, links and the graph are all
   derived from `ObjectDoc` at boot and on each changed path. Deleting the derived structures loses
   no information; a body edit is the only way to change what they say.
2. **One grammar for a wiki link.** `[[TypeKey/Title]]`, inner text trimmed, the **first** `/`
   separates the type key from the title (a title may contain `/`), no newline inside the brackets,
   inner length at most 200 characters. `TypeKey` follows the existing key grammar; `Title` is the
   record's display title, compared trimmed and case-insensitively. `[[` inside a fenced code block,
   an inline code span, or preceded by a backslash is text, not a link.
3. **One resolver.** `SpaceIndex` owns the `(type key, folded title) -> [Uuid]` lookup. The search
   route, outgoing links, backlinks and the graph all call it; no route re-implements title matching.
4. **Resolution is exact and unique.** One live record of that type with that title resolves;
   zero is `unknown`; more than one is `ambiguous`. The UI names the condition; neither case is
   guessed at or silently dropped.
5. **A record detail is one read.** Outgoing links and backlinks come from the same
   `GET /objects/{id}` response via `with`, not from a second graph endpoint or a per-row fetch.
6. **Search is ranked; table `q` is a filter.** The palette's results are ordered by the server and
   carry a snippet. The type table keeps its substring filter, saved view and sorts. The two are not
   unified in this milestone because their contracts differ.
7. **Editing stays plain text.** The textarea is the editor, the toolbar and the `/` menu edit the
   selection, and the preview renders the same markdown the server stores. No HTML is stored, no
   editor library is added, and every toolbar action and slash command is a pure function over
   `(value, selection)`.
8. **A link is not a frontmatter value.** A wiki link never becomes a relation property on save and
   never writes a new key. The relation *edge* is derived, which is what lets M5 stay at schema 4.
9. **Broken links are visible, not destructive.** An unresolved or ambiguous link renders with a
   warning treatment and a title; the body text is never rewritten or normalized.
10. **No new dependency, no new route family.** One new read route (`/search`) and one extended
    object read; the graph reuses the detail payload; SVG and the caret mirror are hand-written.

### 4.1 AGENTS.md and the delivery protocol

`AGENTS.md` and `docs/ROADMAP.md`'s delivery protocol are binding for every checkpoint; read them
before starting one and follow them where this file is silent. Concretely:

- **The user commits; the agent never does.** No `git add`, `commit`, `tag`, `push`, `stash`,
  `reset` or history rewrite. Leave the checkpoint's changes in the working tree and end the report
  with one **Proposed commit** line.
- **One checkpoint per turn**, with the full report: **Built** (files and observable behavior),
  **Concepts** (the Rust/React idea the step used and where to read further), **Decisions taken**,
  **Verified** (exact commands and observed output, including failures exercised), **Test it**
  (numbered, route + viewport/device + action + expected result; say what this machine cannot run),
  **Inspect**, **Proposed commit**.
- **Never claim a gate that did not run.** Rust:
  `cargo build --workspace && cargo test --workspace && cargo fmt --all --check &&
  cargo clippy --workspace --all-targets -- -D warnings`. Web:
  `npm run lint && npm run typecheck && npm run test:run` (plus `npm run build` in checkpoint 8).
  HTTP behavior is pinned in `routes::tests` over the real router; web helpers get a
  `lib/*.test.ts`.
- **One implementation per behavior.** Tokenization, scoring, the title lookup, link parsing,
  backlink assembly, the local graph's node set and the layout are each defined once and consumed.
  If a second call site needs the same rule, extract the helper in the same checkpoint.
- **The changelog moves with the user-visible change.** Open an `Unreleased` entry in checkpoint 2
  (search is the first visible behavior), extend it in 4–7, and rename it to `0.5.0` in checkpoint
  8. Follow `web/src/content/changelog.ts`'s rules: one change per sentence, user outcomes only, no
  file names, component names, endpoints or schema keys.
- **The docs stay true.** Checkpoint 8 updates `AGENTS.md`, `docs/ROADMAP.md` and this file, and
  folds any new body-editor or graph visual decision into `DESIGN.md` and
  `.impeccable/design.json`. `PRODUCT.md` needs no change; if a principle is in play, cite it in
  the report rather than restating it.
- **No workspace-wide change.** A helper belongs in `lib/` or in the core module that owns it. Do
  not add a crate, a search library, a graph library or an editor library for one surface.

### 4.2 Handedness and the visual system

`DESIGN.md` and `.impeccable/design.json` are normative. The record page is not a handedness
surface by default, but the new editor toolbar and the links panel contain action rows:

- **Reading order never moves; thumb-zone actions do.** The toolbar's formatting buttons are
  reading-order controls and do **not** mirror. The links panel's rows are navigation, not actions,
  and keep their order. Only an action menu attached to a row follows the existing `CardActions`
  rule.
- **Action rows use `ThumbRow`** where a row carries a primary action; a backlink row is one link,
  so it needs no reversal.
- **The body toolbar is not a thumb-zone strip.** It sits above the textarea at full width, with
  44 px coarse targets and 16 px coarse text; do not move it to the bottom edge or mirror it.
- **The graph never mirrors.** Node positions and labels follow the same layout in both modes;
  handedness changes action placement, never data.
- **The caret menu follows its caret**, not the thumb; Base UI is not involved, so no anchor flips
  are introduced. The slash menu is the same popup in command mode, so its rows and marker column
  obey the same sizes and never mirror.
- **Toasts and sheets are already handled** by `:root[data-hand="left"]`; do not re-implement them.

From the visual system, without re-deciding it: tokens only (`text-muted`, `rule`, `bg-raised`,
`rounded-field`, …), never raw colours; the 11 px text floor; 44 px coarse targets and 16 px coarse
inputs; hairline dividers, never cards or shadows; one accent per view; Lucide icons and the app's
type icons, no new icon set. The graph uses the accent for the centre and `rule` hairlines for
edges; relation and mention edges differ by dash pattern **and** a text legend, never colour alone.
The editor's split view appears at `lg` and above; below it, the existing Write/Preview switch is
the only mode control.

Every checkpoint's live acceptance is run at **390 and 1440**, and in **both handedness modes** for
the surfaces it touches — the editor toolbar, the caret menu, the links panel, and the graph
included.

## 5. Checkpoints

Each checkpoint is one turn. Do not combine them. Stop after each and report in the delivery
protocol's format. Every checkpoint inherits §4.1 and §4.2 in full; the per-checkpoint lists below
name only what is specific to them.

### Checkpoint 1 — The inverted index in the core

**Files:** `crates/core/src/search.rs` (new), `crates/core/src/lib.rs`,
`crates/core/src/index.rs`.

**Change:**

- Add `pub mod search;` and a module whose public surface is exactly what the server needs:
  - `pub fn tokens(text: &str) -> impl Iterator<Item = String> + '_` — lowercase Unicode
    alphanumeric runs, in order, no stopwords. A token is capped at 64 characters; an over-long run
    is split at 64-character boundaries rather than dropped.
  - `pub struct SearchIndex` with `Default + Clone + Debug`, holding
    `postings: BTreeMap<String, BTreeSet<Uuid>>`, a document map with `type_key`, the title's token
    set, a body token -> count map and `updated_at`. Methods:
    - `upsert(&mut self, doc: &ObjectDoc)`; `remove(&mut self, id: Uuid)`;
    - `rebuild<'a>(docs: impl Iterator<Item = &'a ObjectDoc>) -> Self`;
    - `query(&self, text: &str, type_key: Option<&str>, limit: usize) -> SearchResults`, where
      `SearchResults { total, hits }` and `SearchHit { id, score }`.
  - `pub fn snippet(body: &str, query: &str, width: usize) -> Option<String>` — the 180-character
    window around the first query-phrase occurrence, else around the earliest query-token
    occurrence, trimmed at word boundaries where possible, whitespace collapsed. It returns `None`
    for a title-only match. Markdown punctuation is left as text; the frontend renders the snippet
    as plain text, never as markdown.
- **Query semantics.** Trim; split on whitespace; tokenize; at most 8 query tokens; an empty token
  list returns zero results. Every query token must match at least one indexed token that is equal
  to it or starts with it (AND across tokens). Prefix expansion is capped at 64 posting keys per
  token for a deterministic bound; if a prefix has more, only exact matches at that prefix are
  considered. Type filter is applied before scoring.
- **Score, pinned** so the tests can state it: `100` when the folded title contains the whole
  trimmed query as a phrase, `+40` when every query token is in the title's token set, `+8` per
  query token found in the title, `+1` per body occurrence (capped at 20 per token). Ties break on
  `updated_at` descending, then folded title, then id, so the same space answers the same order.
- **Integration in `SpaceIndex`.** Add a private `search: SearchIndex` field and
  `pub fn search(&self) -> &SearchIndex`, so the server never reaches into private state; build it
  in `rebuild_from_disk` from the loaded live objects; `reload_object` calls `upsert` for a live
  file and `remove` for a trashed or deleted one; `reload_space`, `reload_type` and
  `reload_property` need no search work. A re-read of the same object replaces its document rather
  than duplicating its postings.
- Unit tests in `search.rs` and `index.rs`: case and punctuation folding; prefix match; AND across
  two tokens; a body-only hit; title hits outrank body hits; the type filter; a document that is
  updated loses stale tokens; deleting/trashing removes its hits; `rebuild` equals the incremental
  result for the same documents; an empty or whitespace query returns nothing; the score order is
  stable for equal scores. Use the existing `ObjectDoc` construction helpers and a fixed
  `OffsetDateTime`; do not add a fixture file.
- **No route, no web change, no format change, no new dependency.**

**Acceptance:** `cargo test -p thing-core search` passes and shows the tests above; `cargo build
--workspace` is clean. The workspace still reads and writes schema 4 unchanged.

**Verify:** `cargo build --workspace && cargo test --workspace && cargo fmt --all --check &&
cargo clippy --workspace --all-targets -- -D warnings`.

### Checkpoint 2 — The search route and the palette

**Files:** `crates/server/src/routes/search.rs` (new), `crates/server/src/routes/mod.rs`,
`web/src/api/types.ts`, `web/src/api/queries.ts`, `web/src/lib/debounce.ts` (new),
`web/src/lib/debounce.test.ts` (new), `web/src/lib/search.ts`, `web/src/lib/search.test.ts`,
`web/src/components/command-palette.tsx`, `web/src/content/changelog.ts`.

**Change:**

- New route module merged beside `objects::routes()`:

  ```
  GET /api/spaces/{space}/search?q=water&limit=20[&type=plant]          [viewer]
  -> { "query": "water", "total": 12,
       "results": [ { "id": "…", "type": "plant", "type_name": "Plant",
                      "type_icon": "🌿", "title": "Monstera", "icon": "🪴",
                      "snippet": "…the soil stays moist…", "score": 108,
                      "updated_at": "2026-10-31T…" } ] }
  ```

  - `q` is required, trimmed, 1–200 characters; a missing/empty/over-long value is a `422`
    naming `q`. `limit` defaults to 20 and accepts `1..=50`, else `422` naming `limit`. `type` is
    an optional type key that must exist in this space, else `422` naming `type`. Unknown
    parameters are refused by the existing `ApiQuery::finish`.
  - The handler reads through `handle.with_index`: `index.search().query(...)`, then resolves the
    type's display name/icon and the object's icon/title/body for the snippet. `total` is the
    number of matches before the limit; `results` is the capped page. A snippet is present only
    when the body matched; an object with no icon omits `icon` (the API's existing convention).
  - HTTP tests in `routes/mod.rs`, reusing `chore_space`/`day`: a title hit and a body-only hit
    both return; a type filter narrows; a query of two words requires both; `total` exceeds the
    returned page when `limit` is small; a trashed object is absent; `q` missing/empty, a bad
    `limit`, an unknown `type` and an unknown parameter are each `422` naming the field; a viewer
    can read it and a non-member is refused like every other space read.
- **Web data.** `SearchResult` and `SearchResponse` in `api/types.ts`. `queryKeys.search(spaceId,
  query)`; `useSearch(spaceId, query)` with a `URLSearchParams` built from `q`, `limit` and `type`,
  `enabled` on a non-empty trimmed query, `signal` passed to `request`, `placeholderData: previous`
  so the list does not flash between keystrokes.
- **Debounce helper.** `lib/debounce.ts::useDebouncedValue<T>(value, delay)` with a fake-timer test
  (the first value is immediate, an update lands after the delay, a rapid sequence leaves only the
  last value). The palette debounces its query by 150 ms before calling `useSearch`.
- **Delete the old path.** Remove `usePaletteRecords`, `PaletteRecord`, `queryKeys.palette` and the
  per-type fetch; a search hook is the only record lookup the palette has. Do not leave the old
  bounded lookup behind a flag.
- **`lib/search.ts`.** Keep `score`/`rank` for actions, types and spaces (their inputs are already
  in memory). Add `matchRanges(text, query): Array<[number, number]>` — folded, merged ranges for
  every query token, longest first, never overlapping — and test it with repeated tokens,
  punctuation and an empty query. The palette renders the ranges as `<mark>`; the server's order is
  preserved and the client does not re-rank search results.
- **Palette.** `PaletteItem` gains an optional `detail` line. On a non-empty query, the record
  section comes from `useSearch` in server order, labelled `Records`, with the type name ·
  relative time as its hint and the snippet as `detail`. The search runs only when `spaceId` exists.
  The description and the empty-state copy say "titles and text", not "titles". While the debounced
  query is moving, keep the previous rows visible with `aria-busy`; a settled empty result reads
  `No record matches “…” in this space.` Keep actions/types/spaces ranking, keyboard traversal and
  the existing `⌘K`/sheet behavior unchanged. On a phone the extra line stays one line with
  `line-clamp-2`; the sheet's height and focus behavior are unchanged.
- **Open the `Unreleased` changelog entry here**, because search is the first user-visible change:
  searching every record's title and text from the palette, with the matching sentence shown, one
  sentence in the user's terms.

**Acceptance:** On Garden at 1440, `⌘K` → `moist` finds a Plant whose title does not contain the
word, shows the sentence around it, and opens the record on Enter; `⌘K` → `monstera` ranks the title
hit first; a query with two words that appear in different records returns neither; a type filter
sent by `curl` narrows; the palette at 390 opens above the keyboard and the result rows remain
44 px. Deleting the search hook's old per-type requests leaves no request to
`/objects?type=…&sorts=updated_at`.

**Verify:** `cargo build --workspace && cargo test --workspace && cargo fmt --all --check &&
cargo clippy --workspace --all-targets -- -D warnings`; `cd web && npm run lint && npm run typecheck
&& npm run test:run`. Live at 390/1440; `curl -b <cookie>` for a body-only hit, a type filter, an
empty `q`, a bad `limit` and an unknown `type`.

### Checkpoint 3 — Wiki links in the core and on the record read

**Files:** `crates/core/src/links.rs` (new), `crates/core/src/lib.rs`,
`crates/core/src/index.rs`, `crates/server/src/routes/objects.rs`,
`crates/server/src/routes/mod.rs`, `web/src/api/types.ts`, `web/src/api/queries.ts`.

**Change:**

- **Grammar module.** `links.rs` exposes:
  - `pub struct ParsedLink { pub inner: String, pub start: usize, pub end: usize, pub type_key:
    String, pub title: String }` where `start`/`end` are character offsets of the whole `[[…]]`
    in the body and `inner` is the trimmed text between the brackets.
  - `pub fn parse(body: &str) -> Vec<ParsedLink>` — scans once, in order; skips fenced code blocks
    (```` ``` ```` and `~~~`), inline code spans delimited by backticks, and an opening bracket
    preceded by `\`; requires the closing `]]` on the same line; splits on the **first** `/`; a
    missing `/`, an empty type key, an empty title, a newline or an inner over 200 characters is
    not a link. Duplicate raw links are returned as separate occurrences; the callers dedupe.
  - `pub enum LinkStatus { Found(Uuid), Unknown, Ambiguous(usize) }` and
    `pub struct LinkView { raw, type_key, title, status }`.
  - `pub struct RelationBacklink { source: Uuid, property: String }` and
    `pub struct MentionBacklink { source: Uuid, count: usize, snippet: String }`, so the server
    projects a typed list instead of parsing JSON-shaped values out of the index.
- **Title lookup in `SpaceIndex`.** Add `titles: BTreeMap<(String, String), Vec<Uuid>>`, folded
  with `to_lowercase` over the trimmed title, maintained wherever objects are inserted, re-read or
  removed. `pub fn resolve_link(&self, type_key: &str, title: &str) -> LinkStatus` returns `Found`
  only for exactly one live match. A trashed object never resolves.
- **Outgoing and incoming.** `pub fn outgoing_links(&self, id: Uuid) -> Vec<LinkView>` parses the
  record's body, resolves each distinct `(type_key, folded title)` once, keeps first-occurrence
  order, and returns one row per distinct link (the body may repeat it; the API list does not).
  `pub fn backlinks_of(&self, id: Uuid) -> (Vec<RelationBacklink>, Vec<MentionBacklink>)` keeps the
  existing relation scan and adds a scan over every live body through `links::parse`; a mention is
  one source record with the count of links to the target and a snippet around the first one. This
  is O(objects) on a record read, the same order as the existing relation scan; do not build a
  second inverted structure for mentions that a title rename would invalidate.
- **Record read.** `?with=` accepts `links` beside `history` and `backlinks`.
  - `links`: the outgoing `LinkView` array, projected to `{"raw","type","title","id?","status"}`
    with `status` as `"ok" | "unknown" | "ambiguous"` (and `id` only for `ok`) — an unresolved
    link is data, not an error.
  - `backlinks`: the existing relation rows gain `"kind": "relation"` and keep `property`; mention
    rows are `{"kind":"mention","id","type","title","icon?","snippet","count"}`. A source can
    appear in both groups; do not dedupe across kinds, because the two facts are different.
  - Unknown `with` values remain a `422` naming `with`. History is unchanged.
- **Web types and hook.** `ObjectLink`, `LinkStatus`, `Backlink` (a discriminated union), and
  `ObjectDetail.links?` / `.backlinks?`. `useObject(spaceId, objectId, with?)` appends
  `?with=links,backlinks` only when asked and includes `with` in the query key; `pages/object.tsx`
  passes it, `app-shell.tsx` keeps its title-only read. Updating a record invalidates the
  `["space", id]` prefix, so the links refresh with the body.
- HTTP tests: a body with two resolvable links, one unknown and one ambiguous; a link inside a
  fenced block and inside inline code does not appear; deleting the target turns a found link into
  `unknown`; a relation and a mention both appear in `backlinks` with their kinds; a trashed source
  is not a backlink; a viewer can read both; `with=links,backlinks` is accepted and an unknown
  `with` is still refused.
- Core tests: grammar edge cases (first slash, `/` in a title, escaped bracket, fence with a
  language tag, inline code, unclosed bracket, newline, 200-character bound); resolution with
  case/whitespace; ambiguity on two same-title records; a trashed target does not resolve; a title
  rename makes an outgoing link unknown without touching the body.

**Acceptance:** `curl` on a seeded record with `with=links,backlinks` shows one row per body link
with the right status and a mention row from the Chore that points at Monstera; an object file is
byte-identical before and after the read (the read writes nothing); one with a code block containing
`[[plant/Monstera]]` does not report that edge.

**Verify:** `cargo build --workspace && cargo test --workspace && cargo fmt --all --check &&
cargo clippy --workspace --all-targets -- -D warnings`; `cd web && npm run lint && npm run typecheck
&& npm run test:run`. `curl -b <cookie>` the detail route for the resolved, unknown, ambiguous and
code-block cases.

### Checkpoint 4 — Render wiki links and navigate

**Files:** `web/src/lib/wiki-links.ts` (new), `web/src/lib/wiki-links.test.ts` (new),
`web/src/components/markdown-view.tsx`, `web/src/components/object-panel.tsx`,
`web/src/pages/object.tsx`, `web/src/content/changelog.ts`, `DESIGN.md`.

**Change:**

- **A pure splitter, then a remark plugin.** `splitWikiText(text, resolve)` returns plain/link
  segments for one text node; `wikiLinks(resolve)` walks the mdast children, skips `code` and
  `inlineCode` nodes, and replaces text nodes with segments. The resolver is a
  `Map<rawInner, ObjectLink>` built from the record's `links`; a raw inner string that is not in
  the map is `neutral` (it may be a link typed but not yet saved), while a row present with
  `status: "unknown" | "ambiguous"` is `broken`.
- `MarkdownView` gains optional `links` and `spaceId`. With a map, a resolved link renders as an
  internal link with the title as its label, the accent underline and an `aria-label` naming the
  target; a broken one renders as a `<span>` with a dotted warning underline and a `title` naming
  the condition; a neutral one renders as ordinary body text. `href` for a resolved link is
  `/s/{space}/o/{id}`; the existing `a` renderer uses react-router's `Link` for a same-app path and
  keeps `target="_blank"` for external URLs. Without `links` (the history panel), `[[…]]` stays
  literal text — no fake links into a revision body.
- `ObjectPanel` passes `links` from the detail to both the preview and the read mode;
  `pages/object.tsx` requests `with=links,backlinks` and passes them down. The draft's newly typed
  link is neutral until the save returns the refreshed payload, then it becomes resolved or broken.
- **Design.** Add a short `DESIGN.md` record-page rule for links: resolved links use the accent
  underline and open in place; broken links are dotted warning text with a title, never a navigation
  target; code spans and fences are never linkified. Fold the same wording into
  `.impeccable/design.json` if it carries the record-page rules there.
- **Extend the `Unreleased` entry** with one sentence: writing `[[Type/Title]]` in a body links to
  that record, and a link that no longer matches is marked instead of vanishing.

**Acceptance:** On Garden at 1440, a Chore body containing `[[plant/Monstera]]` renders as a link;
clicking it opens Monstera without a full reload; the browser Back returns to the Chore. A link to a
missing title is dotted and does not navigate, and its tooltip says no record matches. The same text
inside a code fence stays monospaced and unlinked. At 390 the link is tappable at body text size and
the toolbar does not shift. In left-handed mode the body text order is unchanged.

**Verify:** `cd web && npm run lint && npm run typecheck && npm run test:run`. Live at 390/1440 in
both handedness modes, with the resolved, unknown and code-fence cases; check the Back behavior and
the history panel's literal text.

### Checkpoint 5 — The writing surface

**Files:** `web/src/components/markdown-editor.tsx` (new),
`web/src/lib/markdown-edit.ts` (new), `web/src/lib/markdown-edit.test.ts` (new),
`web/src/lib/caret.ts` (new), `web/src/lib/caret.test.ts` (new),
`web/src/components/object-panel.tsx`, `web/src/content/changelog.ts`, `DESIGN.md`.

**Change:**

- **Extract the body editor** from `ObjectPanel` into `MarkdownEditor` with props for the value, a
  change callback, `disabled`, `spaceId`, `links`, a `resetToken` and the preview renderer.
  `ObjectPanel` keeps ownership of the draft, the dirty marker and Revert; the editor owns the
  textarea, toolbar, preview mode, the caret menu and its two triggers, and resets its mode to
  Write/Preview on a `resetToken` bump exactly as the current `setMode` does after a reload. The
  record's save payload and every existing behavior (conflict, revert, focus return, sticky bar,
  16 px coarse text) stay exactly as they are.
- **Toolbar.** A hairline row above the textarea: bold, italic, inline code, heading, bulleted
  list, numbered list, quote, link and wiki link, each a Lucide icon button with an `aria-label`
  and a `title`; 32 px fine, 44 px coarse; `onMouseDown` prevents focus loss so the selection
  survives. On a phone the row wraps into two rows so every tool is visible without horizontal
  guessing — seven tools, then the two link tools closing the second row with the Write/Preview
  switch pinned at its right edge; from `sm` up it is one row with the switch at the trailing edge.
  The wiki-link button inserts `[[` at the selection and opens the wiki mode of the caret
  menu; the link button calls the same `insertLink` helper the `/link` command uses — a ranged
  selection is wrapped and the URL is selected, a collapsed selection inserts `[text](url)` with
  `text` selected.
- **Slash commands.** Typing `/` as the first non-whitespace character of a line opens the same
  caret menu in command mode. The table is a frozen `SLASH_COMMANDS` array in
  `lib/markdown-edit.ts`; `matchSlash(query)` is the only filter, so the menu and the tests read one
  list:

  | Command | Aliases | Effect |
  |---|---|---|
  | Heading 1 | `/h1`, `/h` | `# ` before the line |
  | Heading 2 | `/h2` | `## ` before the line |
  | Heading 3 | `/h3` | `### ` before the line |
  | Bulleted list | `/bullet`, `/ul` | `- ` before the line |
  | Numbered list | `/number`, `/ol` | `1. ` before the line |
  | Quote | `/quote`, `/q` | `> ` before the line |
  | Inline code | `/code` | a placeholder in single backticks |
  | Code block | `/block`, `/pre` | a fenced block, caret inside |
  | Bold | `/bold`, `/b` | `**bold**`, placeholder selected |
  | Italic | `/italic`, `/i` | `*italic*`, placeholder selected |
  | Link | `/link` | `[text](url)` |
  | Wiki link | `/wiki`, `/record` | inserts `[[` and opens the wiki mode |

  Rows print the command name and, in muted monospace, the marker it inserts (`#`, `-`, `1.`, `>`,
  backtick, fence, `**`, `*`, `[text](url)`, `[[…]]`) so the menu teaches the syntax it hides. The
  query matches an id or alias case-insensitively by prefix first, then substring, in table order;
  an empty query lists all twelve, and the list caps at eight visible rows on a fine pointer and
  five with the next row peeking on a coarse one, then scrolls.
- **Applying a command.** `applySlashCommand(value, selection, trigger, id)` deletes the `start`
  offset through the caret, collapses the selection at `start`, then calls the same helper the
  toolbar calls — `toggleLinePrefix`, `wrapSelection`, `insertFencedBlock`, `insertLink` or
  `insertWikiLink` — so a command has no formatting logic of its own. Line commands affect the
  caret's line only; text typed after the command on that line is kept. Inline commands always take
  the placeholder path (`wrapSelection` with the collapsed selection, which leaves the placeholder
  selected), because typing the `/` already replaced whatever was selected — an inline command
  therefore inserts `**bold**` with `bold` selected rather than wrapping text that no longer exists.
  Formatting an existing selection stays the toolbar's and `Mod+B`/`Mod+I`'s job.
- **Slash trigger and grammar.** `slashTrigger(value, offset)` returns `{ start, query } | null`,
  where `start` is the offset of the `/`. It fires only when the caret is on a line whose text
  before the `/` is whitespace only (up to three spaces of markdown indentation are fine; a slash
  after a bullet, quote or prose character is not), the character before the `/` is not `\`, the
  run from `/` to the caret matches `[a-z0-9-]*` and is at most 20 characters, and `isInFence` is
  false. `isInFence(value, offset)` counts fence lines above the offset — a line whose trimmed text
  starts with three or more backticks or tildes — and reports inside only when that count is odd,
  so `/` in a code sample opens nothing and a slash after the closing fence does. Any character
  outside the grammar (space, punctuation, newline) ends the trigger: the menu closes and the text
  stays exactly as typed; no command is applied, and the body is never rewritten to remove a slash
  the user meant as text.
- **Pure edit helpers** in `lib/markdown-edit.ts`, each returning `{ value, start, end }`:
  `wrapSelection` (wraps, unwraps an existing identical wrapper, and uses a placeholder when the
  selection is collapsed), `toggleLinePrefix` (per line, preserving indentation, removing the
  prefix when every non-empty selected line already has it), `continueList` (Enter at the end of a
  list or quote line starts the next item and increments an ordered number; Enter on an empty item
  removes the marker and exits), `indentSelection` (Tab/Shift-Tab over the selected lines, two
  spaces), `insertLink`, `insertFencedBlock`, `insertWikiLink`, `slashTrigger`, `isInFence`,
  `matchSlash` and `applySlashCommand`. Unit-test each with collapsed and ranged selections,
  multi-line selections, existing markers, ordered numbers and an empty line; for the slash pair,
  also triggers at the start of the body, after indentation, after prose, after a bullet marker,
  mid-line, escaped `\/`, after 20 characters, inside an open fence and after a closed one; a
  no-match query; and each command's resulting text and selection.
- **Shortcuts.** `Mod+B` bold, `Mod+I` italic, `Mod+K` link, `Mod+Shift+X` inline code; Enter and
  Tab as above. They fire only while the textarea is focused and never when the browser's own
  shortcut owns the combination. Key arbitration is ordered and explicit: an open caret menu takes
  ArrowUp/Down, Enter, Tab and Escape first; only then do `Mod+*` shortcuts and Enter/Tab list
  continuation run. Escape closes the menu; with no menu open it blurs the field, so the record
  page's Escape-to-go-back handler never fires while the body has focus. Space is never an accept
  key, because it belongs to prose. No other global hotkeys change.
- **Live preview.** At `lg` and up, Write mode is a two-pane split: the textarea and a scrollable
  rendered preview of the same draft, updating per keystroke; Preview mode shows the rendered body
  alone at full width. Below `lg`, the existing single pane and Write/Preview switch remain. The
  textarea stays mounted while Preview is showing, so returning to Write keeps the native undo
  history and the selection; the first tap on Write raises the field with the caret at the end of
  the draft. On a phone the field and the preview start at 14rem, so the toolbar, field and save bar
  fit above the keyboard; from `sm` up they are 22rem. The preview uses the same `MarkdownView` and
  the same link map as read mode.
- **One caret menu, two triggers.** `lib/caret.ts` measures the caret by mirroring the textarea's
  computed font, padding, border and scroll offset into an off-screen div and reading the marker's
  rectangle (tested over a fake element for the arithmetic and clamped to the field's box). One
  popup component inside `markdown-editor.tsx` renders both modes: a labelled `role="listbox"` with
  option ids, `aria-activedescendant` on the textarea, rows 32 px fine and 44 px coarse, the
  textarea keeping focus, and no Base UI popover (it anchors to a caret, not an element). Slash
  mode filters `SLASH_COMMANDS` in memory; wiki mode debounces the partial 150 ms and calls
  `useSearch(spaceId, partial)` with a limit of 20, showing the type name and title. Both modes move
  with ArrowUp/Down, insert with Enter or Tab and close on Escape, blur, a caret move or a click
  elsewhere. Slash mode's `/wiki` hands over to wiki mode with an empty query in the same popup.
  ArrowUp/Down keep the active row inside the list's visible rows, and the list scrolls on its own
  without dismissing the menu.
  The popup flips above the caret when it would cross the bottom edge, is clamped horizontally to
  the field, and reads the keyboard height and pan from `lib/viewport.ts` (the metrics behind the
  root's `data-keyboard`) so it never lands under the on-screen keyboard. It ends at the phone
  bar's top so its last row is never painted under that bar, and on a coarse pointer it sizes to
  show the next row peeking below the last full one.
- **No new dependency.** The mirror, the popup, the toolbar and the command table are hand-written.
- **Design.** Add the record-page body rules to `DESIGN.md`: the toolbar's order and sizes and its
  two-row phone wrap, the field heights, the split at `lg`, the caret menu's placement and
  phone-bar clearance, row size and the two modes, the slash menu's marker column and peek row,
  and the rule that editing changes text, never the stored HTML.
- **Extend the `Unreleased` entry** with one sentence: formatting and links while writing, with a
  live preview, a `/` menu at the start of a line and a list that keeps going when you press Enter.

**Acceptance:** At 1440, selecting a word and pressing `Mod+B` wraps it and keeps the selection;
`Mod+K` produces `[text](url)` with the URL selected; Enter on `- water` continues the list, Enter
on the empty item exits it; Tab indents two spaces; the preview updates while typing and matches the
saved render. Typing `[[mon` opens a listbox under the caret listing Monstera; Enter inserts
`[[plant/Monstera]]` and the save then renders it as a resolved link. Typing `/` on an empty line
lists all twelve commands with their markers; `/qu` narrows to Quote; Enter turns the line into
`> ` and keeps its text; `/b` inserts `**bold**` with `bold` selected; `/wiki` inserts `[[`
and opens the record listbox; Escape leaves `/qu` as literal text; `/` inside an open fence, after
prose, and in `/usr/bin` or `2026/11/01` opens nothing. At 390 the toolbar wraps into two rows with
all nine tools and the switch visible, every button and menu row is 44 px, the textarea is 16 px,
tapping Write focuses the field at the end of the draft, the caret menu stays above the keyboard and
the phone bar, and the save bar never covers the field. Switching to Preview and back keeps the
native undo history and the selection. In left-handed mode the toolbar order, the menu order and
its marker column do not mirror.

**Verify:** `cd web && npm run lint && npm run typecheck && npm run test:run`. Live at 390/1440 in
both handedness modes: every toolbar action, every shortcut, every slash command by keyboard and by
tap, the trigger's negative cases (mid-line, fenced, escaped), filtering by alias, Enter/Tab/Escape
and Space, list continuation and exit, Tab indent, preview parity, wiki autocomplete, and a
save/undo cycle.

### Checkpoint 6 — The links panel

**Files:** `web/src/components/links-panel.tsx` (new), `web/src/pages/object.tsx`,
`web/src/content/changelog.ts`, `DESIGN.md`.

**Change:**

- **One panel per record**, below the body and above history, with the heading `Links`, a mono
  count and two groups that appear only when non-empty:
  - `Linked from` — relation backlinks: type icon/glyph, the source title, its type name, the
    property's display name (`via Watering note`), and a row-sized navigation target.
  - `Mentioned in` — body mentions: the source title, its type name, the snippet and, when
    `count > 1`, a mono `×N`.
- Rows navigate to `/s/{space}/o/{id}`, are 44 px on a coarse pointer, and use the existing
  `ThingIcon`/type glyph. The whole row is the link; there is no per-row action, so no handedness
  reversal is introduced.
- **Empty state:** `No links yet. Add a relation property or write [[Type/Title]] in a body.` The
  explicit syntax in the copy is the only place it is taught; keep the backticks out of the prose.
- The panel reads from the same `useObject(..., with)` payload; a save or a live event that
  invalidates `["space", id]` refreshes it. A viewer sees it read-only. A source record that is
  trashed after it was loaded disappears on the next read; a deleted target never appears as a
  mention because resolution excludes trashed records.
- **Design.** Record the panel's order and type scale in `DESIGN.md` so the record page's sections
  read as one instrument: Properties, Body, Links, History, Trash.
- **Extend the `Unreleased` entry** with one sentence: seeing which records point at the one you
  are reading.

**Acceptance:** Monstera's record shows the Chore in `Mentioned in` with the sentence around the
link, and any relation property that targets it in `Linked from` with the property's name; clicking
a row opens that record. A record with neither group shows the empty sentence and no heading count.
At 390 rows are 44 px and the panel has no horizontal scroll. After adding a `[[…]]` link and
saving, the target's panel gains the source without a manual refresh.

**Verify:** `cd web && npm run lint && npm run typecheck && npm run test:run`. Live at 390/1440 in
both handedness modes on a record with both kinds, a record with one kind, and an empty record; add
a link, save, open the target, and confirm the refresh.

### Checkpoint 7 — The local graph

**Files:** `web/src/lib/graph.ts` (new), `web/src/lib/graph.test.ts` (new),
`web/src/components/local-graph.tsx` (new), `web/src/components/links-panel.tsx`,
`web/src/content/changelog.ts`, `DESIGN.md`.

**Change:**

- **Node set.** `buildLocalGraph({ center, links, backlinks })` returns `{ nodes, edges, hidden }`:
  the centre record, every resolved outgoing link target, every backlink source; deduplicated by
  id. Edges carry `kind: "relation" | "mention"`; an edge that is both is one relation edge with a
  `mention` flag, because the panel above already lists both facts. Sort deterministically
  (relations, then outgoing links, then mentions; title; id), cap at 24 nodes and report the
  overflow in `hidden`. A missing/ambiguous outgoing link is not a node.
- **Layout.** `layoutLocalGraph(nodes, edges, width, height)` places the centre at the box centre
  and the one-hop nodes on one ring (a second, wider ring only when more than 12), evenly spaced
  from the top, sorted by the node order. It returns positions and clipped edges; no randomness and
  no force simulation, so the same record draws the same graph. Unit-test determinism, ring
  membership, the cap and the empty case.
- **Component.** `LocalGraph` renders a responsive `viewBox` SVG: `rule` hairlines for edges
  (solid relation, dashed mention), the centre as an accent-ringed node, labels in the body type
  scale, and a text legend (`— relation`, `-- mention`). Each non-centre node is an SVG `<a>` to
  `/s/{space}/o/{id}` with a visible focus ring and an `aria-label`; the centre is `aria-current`
  and not a link. The same nodes are already navigable in the panel's rows below, so the graph
  adds a shape, not a second information architecture. On a coarse pointer or below `sm`, the graph
  is behind a `Graph` disclosure that starts closed; at `sm` and up it is always visible when there
  is at least one edge.
- The graph takes its data from the panel's existing `links`/`backlinks` props; no new request and
  no new endpoint. Empty graphs render nothing, leaving the empty state to the panel.
- **Design.** Add the graph's size, node/label scale and legend to `DESIGN.md`; the graph never
  mirrors in left mode.
- **Extend the `Unreleased` entry** with one sentence: a small map of the record and everything
  that points at or from it.

**Acceptance:** Monstera's graph shows the centre plus the Chore mention and any relation sources;
clicking a node opens it, and the focus ring is visible in both handedness modes. A record with 30
backlinks shows 24 nodes and a `+6 more` line that scrolls to the panel. A record with no edges
shows no graph. At 390 the graph is closed until `Graph` is pressed and the panel's rows remain the
primary path. The same record opened twice draws the identical layout.

**Verify:** `cd web && npm run lint && npm run typecheck && npm run test:run`. Live at 390/1440 in
both handedness modes: a record with one edge, one with >24, one with none; click and keyboard
navigation; the disclosure; determinism by reopening.

**Shipped extension (2026-11-02).** The same drawing gained a `Local` / `Space` scope switch:
`layoutSpaceGraph` places every live record by degree around the current one, pan/zoom and node
offsets are view-only, and no extra read or route was added. This is why §7's graph entry and
`docs/ROADMAP.md` record the whole-space map in `0.5.0` rather than `0.5.1`.

### Checkpoint 8 — Version, docs and the release pass

**Files:** `Cargo.toml`, `Cargo.lock`, `web/package.json`, `web/package-lock.json`,
`web/src/content/changelog.ts`, `AGENTS.md`, `docs/ROADMAP.md`, this file, and `DESIGN.md` /
`.impeccable/design.json`.

**Change:**

- Bump the workspace and web to `0.5.0`. Promote the `Unreleased` entry opened in checkpoint 2 and
  extended in 4–7 to `0.5.0`, keeping the established shape: search across titles and text with the
  matching sentence, wiki links that open the record, a links panel with relations and mentions,
  the local graph, and the writing toolbar with live preview and autocomplete. Apply the changelog's
  own rules: one change per sentence, user outcomes only, `details` for the long tail, no file
  names, component names, endpoints or schema keys.
- Update `AGENTS.md`'s current state and its crate surface: `search` (tokens, index, query,
  snippet), `links` (parse, status, resolution), `index` (the title map, search and link methods),
  `routes/search` and the record route's `with=links`. Add the v0.5.0 paragraph to
  `docs/ROADMAP.md`, mark M5 landed and this file LANDED, and correct the M5 wording that promised
  an "on-disk inverted index" to the shipped derived index.
- Fold the body-editor and graph decisions into `DESIGN.md` and `.impeccable/design.json` so they
  describe the shipped UI, not a different world. If a visual decision was settled in a checkpoint,
  it was recorded there already; this step verifies it.
- Run the full gates; core and server changed in checkpoints 1–3, so the Rust gates are not a
  formality: `cargo build --workspace && cargo test --workspace && cargo fmt --all --check &&
  cargo clippy --workspace --all-targets -- -D warnings` and
  `cd web && npm run lint && npm run typecheck && npm run test:run && npm run build`.
- Device pass: the v0.4.3 physical-iPhone keyboard gate is still open and still precedes any
  keyboard claim. Record what was checked on hardware, if any; emulation only must be said so.
  Include one pass with left-handed mode on the editor, links panel and graph.
- Do not tag or deploy from this checkpoint; the user commits.

**Acceptance:** Footer and changelog read `0.5.0`; every gate passes; the docs describe the search
route, the `with=links` extension, the link grammar and the derived index that exist; `DESIGN.md`
matches the shipped editor and graph; the device-pass result is recorded honestly, including the
physical-iPhone gap.

## 6. Manual QA matrix

| Surface | Desktop 1440 | Phone 390 (coarse) |
|---|---|---|
| Palette search | Body-only hit with snippet; server order; type filter via `curl` | Sheet above the keyboard; rows 44 px; focus raised on open |
| Wiki links | Resolved link navigates in place; unknown dotted; code fence literal | Same tap, body size; no horizontal scroll |
| Editor | Toolbar, shortcuts, list continuation/exit, Tab indent, split preview at `lg` | One toolbar row, 44 px buttons, 16 px textarea, Write/Preview switch |
| Autocomplete | Caret-anchored listbox, arrows/Enter/Escape, insert `[[type/title]]` | Listbox above the keyboard, 44 px rows, insert by tap |
| Slash menu | `/` at line start lists twelve with markers; alias filter; Enter prefixes the line; Escape/Space leaves the text literal; silent mid-line, after prose, escaped and inside a fence | 44 px rows, popup above the keyboard, insert by tap |
| Links panel | Relation + mention groups, snippets, counts, empty state | 44 px rows; no horizontal scroll |
| Graph | ≥24-node cap, legend, keyboard nodes, deterministic layout | Closed `Graph` disclosure, opens above the bar, nodes tappable |
| Handedness | Toolbar and text order unchanged; graph not mirrored | Same, plus no double reversal in any new row |
| Read-only | Viewer sees links, mentions and graph; no editor | Same |
| Format | `FORMAT_VERSION` 4; an object file has no new key after a link, a save or a search | — |

## 7. Decisions taken while scoping

- **The index is derived in memory, not persisted beside the space.** The roadmap's sentence said
  "on-disk inverted index"; the shipped shape is an index **over** the files on disk, rebuilt at
  boot and updated per changed object. Persisting it would require a sidecar directory or file,
  a rebuild/validate story for a corrupt cache, and a write on every cell edit, while saving only
  the tokenization of bodies the server has already read into `SpaceIndex`. The markdown stays the
  only source; the release checkpoint corrects the roadmap wording. Revisit only with a measured
  boot problem, and then with a cache that is allowed to be deleted at any time.
- **A wiki link is a graph edge, not a frontmatter property value (settled 2026-11-01).** The
  roadmap says links "create a relation" and also that M5 is "UI plus an index"; relation
  properties already exist. Writing a new `links` key, or guessing which relation property a link
  belongs to, would be a format change and a second relation grammar. The index derives the edge,
  the record read exposes it, and the links panel labels where it came from. No file gains a key.
- **Resolution is unique and explicit.** Exactly one live record of the type and title resolves;
  zero and many are reported as `unknown`/`ambiguous`. Picking the oldest, the most recent or the
  first file would make a link mean something different after an unrelated edit. The cost — a link
  to a duplicate title is visibly broken — is honest and fixable by renaming.
- **Renames do not rewrite bodies.** A multi-file rewrite on a title edit would be surprising,
  would need its own revisions, and would race with other editors. A broken link is surfaced in the
  body and in the panel; the user can fix the sentence. A future link-repair action can be explicit
  and previewed.
- **The grammar uses the first slash and the type key, not the display name.** Type keys are
  stable slugs; display names are editable. The autocomplete inserts the key so a person never has
  to know it, and the rendered label is the title. A title may contain `/`, which the first-slash
  rule preserves.
- **Only live records resolve.** A trashed target makes the link unknown, and a trashed source
  disappears from backlinks. The trash is reversible, so the facts return when the record is
  restored; nothing is cached across that boundary.
- **Mentions are scanned on demand, not indexed.** A title rename changes every mention's
  resolution, so a maintained mention index would need the same invalidation as the title map plus
  a second structure. The existing relation backlinks already scan every document; mentions join
  that scan, and the read stays O(objects) on one record. Measure before adding a second index.
- **Search stays out of the table filter.** The table's `q` composes with a saved view, sorts and
  paging, and its substring rule is deliberate; the palette is a ranked, snippet-bearing global
  read. Unifying them would either slow the table's filter contract or weaken the palette's order.
- **The palette is server-ranked.** Client ranking over a bounded per-type lookup is exactly the
  gap M5 closes; results are rendered in the order the server returns. Actions, types and spaces
  keep the client scorer because they are already in memory.
- **The editor is a textarea with pure helpers.** A contenteditable or an editor library would
  introduce HTML between the user and the markdown and a dependency for one surface. The toolbar
  edits text and the preview renders markdown; every transform is a tested function of value and
  selection.
- **Split preview starts at `lg`.** Below it the existing single pane and switch remain; a split at
  390 would leave both halves unreadable, and a phone already has a keyboard-aware sheet geometry.
- **The autocomplete anchors to the caret via a mirror.** A fixed popover under the field is easier
  but points at the wrong place on a long body; the mirror is a small, local, tested calculation
  and needs no dependency.
- **The local graph is deterministic and capped.** A force layout would be non-reproducible, hard
  to test and prone to overlap; rings by node order are legible for the one-hop neighborhood this
  milestone promises. The cap and the overflow line keep a hub record from drawing an unreadable
  hairball. The space scope reuses the same ring layout over every live record, ordered by degree
  so the record being read stays at the centre; it needs no format change and no extra route.
- **No graph endpoint.** The record detail already carries both directions through `with`; a graph
  endpoint would be a second read of the same edges with its own cache and no new fact.
- **The slash menu is line-start only.** A formatting command is a block decision, and `/` in prose
  is already a path separator, a date and a ratio on this user's data — `/usr/bin` and `2026/11/01`
  must stay text. The trigger therefore needs whitespace before it on the line, which also makes
  the rule cheap to state, test and explain. Cost: `/` after a bullet or quote marker does not
  open the menu; a person formats the line first and then uses the toolbar or a shortcut.
- **One caret popup, two row sources.** Two popups would duplicate the mirror anchor, the keyboard
  handler, the ARIA wiring and the keyboard-height clamp, and they would drift. The mode is a
  discriminated union over the same component; only wiki mode fetches (debounced `useSearch`),
  slash mode filters the frozen `SLASH_COMMANDS` table in memory.
- **Enter and Tab accept; Space never does.** Space is the most common character after a command
  word and the one a person would most resent losing; a menu that eats it would make a typo
  destructive. Escape, blur, a caret move and any out-of-grammar character close the menu and leave
  the typed text alone, so the worst outcome of a mistyped command is literal `/text` the user can
  delete.
- **A slash command never wraps text the `/` already replaced.** A textarea deletes the selection
  when the trigger character is typed, so wrapping "the previous selection" would mean keeping a
  pre-trigger buffer and resurrecting bytes the user watched disappear — and it would race with a
  second edit. Inline commands insert a placeholder and select it, which is the same gesture for a
  person who never had a selection; formatting text that exists is the toolbar's and the `Mod+*`
  shortcuts' job.
- **AGENTS.md wins where this file is silent.** The delivery protocol, the report shape, the
  no-commit rule, the gate commands, the test placement and the release-note style are inherited,
  not restated differently. The changelog opens as `Unreleased` in checkpoint 2, is extended through
  7, and is promoted to `0.5.0` in 8.

## 8. Open questions for review

1. **Duplicate titles.** The current rule makes a same-title link ambiguous. If duplicate titles
   turn out to be common in a real space, the next step is an explicit disambiguator in the grammar
   (for example a short id suffix) or a title-uniqueness rule per type. Both are format-adjacent
   decisions; neither belongs in this cut silently.
2. **Rename repair.** A previewed, explicit "update links to this record" action is the honest way
   to repair a rename. Not in `0.5.0`; the broken-link treatment makes the need measurable.
3. **Space graph timing.** Settled: the local layout landed legibly at 390, so the whole-space
   scope shipped in `0.5.0`; there is no `0.5.1` graph split.
4. **Index persistence.** Only if boot-time tokenization becomes measurable on a large space; the
   cache must remain deletable and non-canonical.
5. **The physical-iPhone gate** from v0.4.3 remains open and is the only thing that can turn the
   phone keyboard claims in §6 from emulation into hardware evidence.

## 9. Beyond this patch

- **M6 — files and images.** Attachments under `files/`, thumbnails, file/image properties, covers.
- **Space-level views** — cross-type saved views, boards by type, custom filter/sort builders; still
  the gap behind the Schedule page's page state.
- **Explicit link repair** after a rename, if §8.2 is asked for.
- **Search refinements** — per-type scoping in the UI, result counts, and a keyboard shortcut to
  search the current type; none is needed to close M5.
- **Slash-command growth** — tables, callouts, to-dos and dividers need block helpers and a
  renderer decision that `react-markdown` + `remark-gfm` does not cover today; the twelve commands
  are the set the current markdown can round-trip.
- **In-app account settings** — password change and display name, still the largest account gap.

## 10. Release checklist

- [x] Checkpoints 1–8 landed, one per commit, gates green after each.
- [x] `FORMAT_VERSION` still `4`; no object file gains a key; no new revision action.
- [x] No new dependency; one new route (`GET /search`) and one extended detail read
      (`with=links`); the graph has no endpoint.
- [x] `web/package.json` and `Cargo.toml` at `0.5.0`; changelog and footer agree; the `Unreleased`
      entry opened in checkpoint 2 was promoted, not rewritten from scratch.
- [x] `AGENTS.md` current state, crate surface and route description updated; `docs/ROADMAP.md`
      v0.5.0 paragraph added, the M5 index wording corrected, and this file marked LANDED.
- [x] `DESIGN.md` and `.impeccable/design.json` describe the shipped editor, links panel and graph.
- [x] Both handedness modes checked at 390 and 1440 on every new surface — in Chromium emulation,
      not on hardware.
- [x] Full Rust and web gates run, not merely claimed; `npm run build` included.
- [x] Device pass attempted; emulation-only items and the open physical-iPhone gate reported, not
      hand-waved. Emulation covered 390 × 844 and 1440 × 900 in both handedness modes; a coarse
      pointer could not be emulated, so the 44 px and toolbar-wrap claims still wait on hardware.
- [x] Commit message prepared for the user (proposed below); nothing staged, committed, tagged or
      pushed.

**Proposed commit:** `Ship v0.5.0 with search, links and the writing surface`
