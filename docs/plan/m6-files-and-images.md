# Milestone 6 — files and images

**Status: PLANNED 2026-11-05 at workspace `0.5.3`.** v0.6.0 is the first format change since
schema 4. It makes attachment bytes part of the canonical space: files live under `files/`, object
frontmatter references them by path, images render as properties and covers, and a record, a
gallery tile and a file row all reach the same hashed bytes. No database enters the space, no
attachment is stored twice under the same name, and every byte stays in the backup chain.
All eight scoping questions were answered by the owner on 2026-11-05 (§8); no open questions remain.

> **Binding instructions — read `AGENTS.md` before any action.** This plan is subordinate to
> `AGENTS.md`; where they differ, `AGENTS.md` wins and work stops until the conflict is resolved.
> The delivery protocol is mandatory: one checkpoint per turn, a clean tree, both gates actually
> run, nothing staged or committed by the agent, and the fixed dev account and `./data` untouched.
> Do not reseed to fix an auth problem, do not rotate the dev password, do not skip a gate, do not
> silently narrow a checkpoint, and do not replace a specified step with a simpler one. If a step
> is ambiguous, ask the owner; do not invent the answer. Prior agents have disregarded the fixed
> password and the no-commit rule; those are task failures, not preferences.

## 1. Scope

In scope:

- **Canonical bytes under `files/`.** `files/<sha256>/<name>`, content-addressed, immutable,
  atomic writes through `SpaceStore` like every other file. The space tarball already contains
  `space.yml`, `types/`, `properties/`, `objects/`, `trash/` and `history/`; it gains `files/`.
- **Schema 5.** An optional `cover` frontmatter key, two new property formats (`file`, `image`),
  and a version bump. Every schema-1…4 file still loads; the writer emits 5.
- **One upload surface.** `POST /api/spaces/{space}/files` takes raw bytes plus a name; the server
  sniffs the type, hashes the bytes, writes atomically and returns the relative path. Same bytes
  and name are idempotent.
- **One read surface.** `GET /api/spaces/{space}/files/{hash}/{name}` serves the bytes to a member
  with the right headers. A `?w=256|512` variant serves a derived thumbnail for images.
- **File and image properties.** A record can hold a downloadable file or an image; the row shows
  the file's name and a thumbnail for images.
- **Covers.** A record's `cover` renders above its title; a gallery tile uses the view's `cover`
  property when it is an image, and the object cover as the fallback.
- **A lightbox.** One image overlay for a record property, a cover and a gallery tile, reusing the
  existing sheet geometry rather than a second modal system.
- **Lifecycle.** Duplicate shares a path without copying bytes; trash keeps bytes and references;
  purge removes an object, and an explicit owner-only GC removes bytes no live or trashed object
  references. A missing file is reported by the space health read, never silently dropped or rewritten.
- **CSV.** A `file`/`image` column exports its path and imports an existing path; CSV carries no
  bytes.
- **Docs and the release.** Format, backup, API, DESIGN and AGENTS updates; version `0.6.0`.

Out of scope, deliberately:

- **Body images.** Pasting or dropping an image into the markdown editor, and rendering
  `![](files/…)` in the body, is **M6.1**, confirmed by the owner on 2026-11-05. The body remains
  the prose field in M6; files are frontmatter values and covers. M6.1 reuses the same `files/`
  paths and the same upload/read routes.
- **Video, audio, PDF previews and range requests.** M6 serves bytes and image thumbnails, not a
  media player.
- **A public or signed URL.** Files are member-only on the same origin, like every other read.
- **A per-space quota.** The self-hosted install has no billing model; the upload limit is per
  file.
- **M7 sync and the desktop shell.** No `since=` file listing, no local directory, no conflict
  folders. M6 only makes the bytes addressable so M7 has something to sync.
- **Image editing, cropping, EXIF stripping as a policy, and antivirus.** Originals are stored
  byte-for-byte; thumbnails are the only derived bytes.
- **Cross-space references.** A path is relative to its own space and cannot be copied into
  another space's frontmatter.

## 2. Starting state

- `FORMAT_VERSION = 4`, `MIN_FORMAT_VERSION = 1` (`crates/core/src/lib.rs`); object frontmatter is
  parsed and emitted by `markdown.rs` with `deny_unknown_fields`.
- The `SpaceStore` trait (`crates/core/src/store/mod.rs`) is the only filesystem surface. It reads
  and writes text; paths are relative and checked; `list_files()` classifies what is canonical and
  `index.rs` reloads only those kinds.
- `ObjectDoc` carries `icon`, `properties` and the markdown body; revisions snapshot title, icon
  and the property map. `RESERVED_KEYS` refuses a property named after any frontmatter key.
- Property formats are `text`, `number`, `checkbox`, `date`, `datetime`, `select`, `multi_select`,
  `url`, `email`, `relation`, `recurrence`; `Value` is `Text`, `Number`, `Bool`, `List` or
  `Recurrence`, and `value.rs` converts YAML ↔ `Value` ↔ JSON by format.
- The object projection in `routes/values.rs` renders every value as `{value, label}`; summaries
  carry `icon`, `rev`, `updated_at`, values and schedule state.
- The gallery (`components/views/gallery-view.tsx`) renders a typographic cover from the view's
  `cover` property; it has no image branch.
- The server is same-origin, cookie-authenticated, with CSP `img-src 'self' data:` and a JSON error
  envelope. `csv.rs` already refuses a body over 5 MiB and names the limit in the message.
- There is no static file route for space content; the SPA fallback serves only the built app.

## 3. Rules this milestone follows

- **`AGENTS.md` is the contract.** Its repository guidelines, credential rule, git rule, test
  rule and delivery protocol bind every checkpoint. Read it end to end before starting and again
  before each checkpoint. A checkpoint is not "done" because code compiles; it is done when its
  acceptance is observed, its tests and gates ran, the changelog names the behavior, and the
  report carries the manual test guide. Stop and ask on any conflict; never pick the simpler task.
- **Markdown stays canonical.** `space.yml`, type/property YAML, object markdown and history are
  the only sources of truth. `files/` is canonical for bytes; thumbnails are derived and
  rebuildable.
- **Only `store` touches the filesystem.** The upload route calls a new binary `SpaceStore`
  method; a handler never calls `tokio::fs` or `std::fs`.
- **No format loss.** A path that no longer resolves is kept in frontmatter and reported; an
  unparseable file is left untouched. The writer never invents a path.
- **Identity and keys are stable.** Content addressing is new, but object ids, type/property keys
  and existing file paths never move because of M6.
- **One spelling.** One file path grammar (`files/<64 hex>/<safe name>`), one value shape (a text
  path), one URL shape, one thumbnail cache. No alternate attachment endpoint, no `"attachment"`
  value mapping, no duplicate name scheme.
- **Auth before bytes.** Every file read and write resolves the space and the caller's role first;
  a 404 and a 403 never leak another member's file.
- **Bounded work.** Files are at most 10 MiB per upload; image decoding is bounded by pixel count;
  no unbounded scan happens on a read.

## 4. The file model

### 4.1 Layout and path grammar

```
files/<sha256>/<name>
files/.thumbs/<sha256>-<width>.jpg|png
```

- `<sha256>` is 64 lowercase hex characters over the exact stored bytes.
- `<name>` is the original filename reduced to a safe form: the stem is slugified (ASCII lowercase,
  dashes, max 64 chars), the extension is kept from the **sniffed** type, and the result is at most
  96 characters. A name that slugs to empty becomes `file`.
- The frontmatter value is the POSIX-relative path `files/<hash>/<name>`; backslashes, absolute
  paths, `..`, extra separators and unknown extensions are refused by one `is_file_path` predicate.
- Same bytes + same name = the same path; the second upload returns 200 and writes nothing. Same
  bytes + different name = two paths and two copies; M6 does not build a second naming scheme to
  deduplicate across names.
- Writes go to `files/.tmp/<uuid>` and rename into place with the same fsync discipline as object
  writes. A file is never executable and never world-writable.
- `.thumbs/` is always derived: excluded from backup guidance, regenerated on demand, and ignored
  by the index and the watcher.

### 4.2 Schema 5

| Change | Detail |
|---|---|
| `FORMAT_VERSION` | `5`; `MIN_FORMAT_VERSION` stays `1`; every 1…4 file loads and upgrades on write |
| `ObjectDoc.cover` | `Option<String>`, a file path; absent means no cover; serialized only when set |
| `Snapshot.cover` | Added beside `icon`, so history and the activity change list can name a cover write |
| `RESERVED_KEYS` | `cover` joins the list; no property may be keyed `cover` |
| `PropertyFormat` | `File`, `Image`, serialized as `file` and `image` |
| `value.rs` | Both formats accept a YAML/JSON string; `expected()` names "a file path" |
| `ObjectSummary` / `ObjectJson` | Both carry `cover`; a gallery card and a record need the same field |
| fixture | `invalid/schema_5.md` becomes `invalid/schema_6.md`; a valid `object_files.md` is added |

`cover` follows the icon's write rules: absent leaves it unchanged on PATCH, `null` removes it, a
path replaces it, and the revision diff names `cover` when it changed. The change list in
`routes/objects.rs` adds the field next to `icon`.

A syntactically valid path whose bytes are missing is **not** a parse failure: the object loads,
the value is kept, and `problems().missing_files` plus the space health read report it. A path
that violates the grammar is a validation failure, so a malformed write is refused rather than
stored.

### 4.3 Value semantics

`file` and `image` values are `Value::Text`. This is a deliberate choice: `Value` is an untagged
enum already carrying one mapping shape (`Recurrence`), so a second mapping variant for attachment
metadata would be ambiguous to deserialize and would duplicate facts. The path is the fact.

- `file`: any accepted byte type; the label is the basename.
- `image`: the bytes must sniff as PNG, JPEG, WebP or GIF; the label is the basename and the row
  may render a thumbnail.
- `is_empty` remains "key absent"; `is_not_empty` matches a path.
- Equality and sorting compare the path; no thumbnail or decode happens in a filter or sort.
- Search indexes titles and bodies only; a file path is not body text.
- CSV exports the path and imports an existing path only; a path whose bytes are absent is a row
  error naming the file.

### 4.4 Upload and read contract

`POST /api/spaces/{space}/files?name=<encoded>` — role `Editor` or `Owner`.

- The body is the raw bytes. Multipart is not used: it would add a parser and a dependency for a
  single field the same-origin client can put in the query string. The handler takes the raw
  request and reads the body only after `space_for` has resolved the space and the caller's role,
  so an unauthenticated or viewer request is refused before a 10 MiB buffer exists.
- `Content-Type` is a hint only. The server sniffs the bytes and chooses the stored extension; a
  request that claims an image but is not one is refused for an `image` upload, and stored as
  `application/octet-stream` for a generic file.
- `image` allowlist: PNG, JPEG, WebP, GIF. SVG is refused (it is an XML script host, and the CSP
  cannot make an inline navigation safe); AVIF and video are out of M6 (§8).
- Limit: 10 MiB per file, checked from the body length before writing, so the refusal is the app's
  JSON `413` sentence. A route-level `DefaultBodyLimit` sits just above it as a backstop for a
  chunked body; a filename after slugification is at most 96 characters.
- Responses: `201 {path, hash, name, mime, size}` on a new file; `200` with the same shape when the
  path already holds identical bytes; `413` over the limit; `415` for a refused image type; `400`
  for a bad name or path; `409` only if the on-disk bytes differ from the computed hash.
- No `DELETE` route in M6; removal is the owner GC in §4.7.

`GET /api/spaces/{space}/files/{hash}/{name}` — role `Viewer`, `Editor` or `Owner`.

- The route accepts only the exact canonical pair; `store::file_path(hash, name)` reconstructs the
  relative path and the store refuses traversal or symlinks.
- Headers: `Content-Type` from sniffing, `Content-Length`, `ETag: "<hash>"`,
  `Cache-Control: private, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`.
  Images use `Content-Disposition: inline`; every other type uses
  `attachment; filename="<name>"`. No range requests.
- `?w=256|512` on an `image` serves a thumbnail with `ETag: "<hash>-<width>"`; on any other type,
  on an unsupported width, or when decoding fails, it serves the original bytes and the original
  ETag at that URL. A missing file is a JSON `404` in the app's envelope.
- The bytes are read through `SpaceStore::load_attachment`; the handler holds at most one 10 MiB
  buffer.

### 4.5 Thumbnails

- Widths 256 and 512 only, from the decoded image, aspect preserved, no upscaling.
- JPEG for opaque sources, PNG for sources with alpha, chosen after decode. The cache path is
  `files/.thumbs/<hash>-<width>.jpg|png`.
- EXIF orientation is applied before scaling, so a phone photo is not sideways in the tile. If the
  pinned decoder cannot report orientation for a source, the request serves the original at that
  width instead of a wrongly rotated thumbnail.
- Generated lazily on the first `?w` read, written atomically, then served from cache. A restore
  that excludes `.thumbs/` therefore repairs itself on first view.
- Decode bounds: at most 40 megapixels and 12 000 px on either side; a larger or malformed image
  returns the original instead of a thumbnail and logs one line at `warn`.
- The `image` crate is the one new workspace dependency, with `jpeg`, `png`, `webp` and `gif`
  features and default features off.

### 4.6 Covers

- **Record.** `cover` renders as a 16:9 hero above the title band, `object-fit: cover`, with a
  Change/Remove pair in the record's overflow menu. It is decorative: `alt=""` when the title is
  already adjacent. Removing writes `cover: null` through the existing PATCH and conflict path.
- **Gallery.** `view.cover` may name an `image` property; the tile draws that image in place of the
  typographic band. When the view has no image cover, the object's own cover is the fallback. A
  non-image cover property keeps today's typographic tile.
- **Board.** Unchanged in M6; a board card stays typographic. Image strips on lanes are out of M6 (§8).
- **Lightbox.** One component built on the existing `SheetViewport`/`Dialog` primitives: the image
  at full width, a close control, Escape, focus return to the opener, and a caption naming the file.
  A `file` value downloads; an `image` value opens the lightbox. No carousel.

### 4.7 Lifecycle and GC

- **Duplicate** copies the cover and every file/image value path; bytes are not copied.
- **Trash** keeps the object's references in the trash file; a trashed object still counts as a
  reference, so a covered record stays viewable from Trash and restores intact.
- **Purge** deletes the object and history, then runs the same reference scan as GC under the
  space write lock: every live and trashed object's `cover` and every `file`/`image` value are
  collected, and any other path under `files/` is removed together with its thumbnails.
- **GC route**: `POST /api/spaces/{space}/files/gc`, role `Owner`, returns
  `{removed, freed_bytes}`. It is also the cleanup path for an upload that was never written into a
  record and for a value the user removed from a record.
- **Missing bytes** are reported by `problems().missing_files` and `GET /api/spaces/{space}/health`;
  they never block a read of the object, and they are never repaired by inventing a file.
- **Watcher**: `files/` is classified as `Attachment`, `.thumbs/` as `Thumbnail`; the index ignores
  both, and the watcher emits no object invalidation for them. A dropped-in file does not change a
  record until a frontmatter write names it.
- **Backup**: `files/` is canonical and required; `files/.thumbs/` is derived and may be excluded.
  The README's tarball sentence is updated to say so.

### 4.8 What M7 inherits

Content addressing is the sync contract. M7 can list a space's files by hash, fetch a changed
object's markdown and its referenced files, and detect a conflict by `rev` without comparing bytes.
M6 exposes `hash` in the upload response and keeps the path derivable; it does **not** add a
`since=` file manifest, a local directory, or a conflict folder.

## 5. Checkpoints

Each checkpoint is one work unit, lands with its own tests, and is reviewed before the next. The
delivery protocol still applies: one checkpoint per turn, gates run, nothing committed by the
agent.

### Preflight — the mandatory read

Before checkpoint 1, read `AGENTS.md` end to end and re-read this plan's §4 and the checkpoint you
are about to do. State in the working notes which rules bind this session: the fixed dev account
(`a@b.c` / `devpass123`), no reseeding or rewriting `data/accounts.sqlite`, no `git add` / `commit`
/ `tag` / `push` / history rewrite, one checkpoint per turn, both gates run for the files touched,
changelog updated in the same commit, and a manual test guide in the report. If any of that is
unclear, stop before writing code and ask. This preflight is not a checkpoint and produces no code.

### Checkpoint 1 — Binary attachments in the store

- `crates/core/src/store/mod.rs`: `FILES_DIR`, `THUMBS_DIR`, `SpaceFileKind::Attachment` and
  `Thumbnail`, `file_path(hash, name)`, `thumb_path(hash, width, ext)`, `is_file_path` (one
  grammar used by validation and the route), `split_file_path`.
- `SpaceStore` gains `save_attachment(path, bytes, expected)`, `load_attachment(path)` and
  `remove_attachment(path)`; `list_files()` returns attachments and thumbnails with their kinds.
- Every exhaustive `SpaceFileKind` match gains an ignore arm: the index does not reload an
  attachment, the watcher emits no object event for one, and the property rename/removal walk
  skips both kinds.
- `store/fs.rs` gets an atomic binary write sharing the existing temp/fsync/rename path; `full()`
  still refuses a path that escapes the space or crosses a symlink.
- **Acceptance:** bytes round-trip byte-for-byte; a failed write leaves no `.tmp`; `../`, absolute
  paths, a wrong hash length and a name with a separator are refused; classify returns the two new
  kinds at the right depths.
- **Tests:** inline store tests over `TempDir`, plus `classify` cases beside the existing table.
- **Files:** `store/mod.rs`, `store/fs.rs`, `index.rs`, `crates/server/src/watcher.rs` (match
  arms only).

### Checkpoint 2 — Schema 5: cover and file/image formats

- `FORMAT_VERSION` 4 → 5; `ObjectDoc.cover`, `Snapshot.cover`, `ObjectSummary.cover`;
  `RESERVED_KEYS` gains `cover`; `PropertyFormat::{File, Image}`; `value.rs` parse/emit/expected/
  compare; `validate` checks paths and image extensions; `index` collects missing files.
- `markdown.rs` round-trips the new field and formats; the schema-5 future fixture becomes
  `invalid/schema_6.md`; `object_files.md` is a canonical schema-5 fixture with a cover, an image
  property and a file property.
- Server projections add `cover`; `snapshot_of` and the history diff name it; `problems_json`
  gains `missing_files`; duplicate, trash and restore preserve it.
- `csv.rs` reads and writes file/image paths as text; a missing path is a row error.
- **Acceptance:** a schema-4 space loads and rewrites as schema 5; cover absent/`null`/path behave
  like icon; an invalid path is refused; a valid path with no bytes loads and appears in the space
  health read;
  an old schema-1…4 fixture still round-trips.
- **Tests:** `tests/roundtrip.rs` over the new fixture; `markdown.rs` version cases; `value.rs`
  format cases; `index` missing-file case; CSV file-column case.
- **Files:** `lib.rs`, `model.rs`, `markdown.rs`, `value.rs`, `validate.rs`, `index.rs`, `csv.rs`,
  `routes/values.rs`, `routes/objects.rs`, `routes/mod.rs` (`problems_json`), `tests/fixtures/`,
  `crates/core/tests/`.

### Checkpoint 3 — Upload and read routes

- New `crates/server/src/routes/files.rs`, merged in `routes/mod.rs`; `POST …/files` and
  `GET …/files/{hash}/{name}`. The owner GC route is registered in checkpoint 7, when its scan
  exists.
- Raw-body upload, SHA-256 through the existing `sha2` dependency, magic-byte sniffing, name
  slugification, 10 MiB cap (`DefaultBodyLimit` plus an explicit length check), role checks through
  `space_for`, atomic write through the store, idempotent 200, `413`/`415`/`400`/`409`, and the
  read headers in §4.4.
- **Acceptance:** an editor uploads a real PNG and gets a path; a viewer cannot upload; a member
  reads it with the right type and ETag; a non-member gets 404/403 without a path leak; a 10 MiB +
  1 byte body is refused by the server, not by the client; a name with `../` is refused; the same
  bytes and name return 200 and do not grow the directory.
- **Tests:** inline HTTP tests with the real router (tiny PNG bytes as a const), role matrix, size,
  sniff mismatch, traversal and headers.
- **Files:** `routes/files.rs`, `routes/mod.rs`, `routes/objects.rs` (shared helpers only if
  needed), `Cargo.toml` (no new dependency expected).

### Checkpoint 4 — Thumbnails

- `image` joins the workspace dependency table; the thumbnail encoder lives behind the store or a
  small `routes/files` helper that reads bytes through the store and writes the cache through
  `save_attachment`.
- `?w=256|512`, bounded decode, JPEG/PNG choice, lazy cache, original fallback, `warn` on a decode
  failure.
- **Acceptance:** the first `?w=256` on a photo writes one `.thumbs` file; the second read does not
  rewrite it; a GIF/PNG with alpha keeps its alpha; a truncated image serves the original; a
  non-image ignores `?w`.
- **Tests:** server tests with a 2 × 2 PNG and a corrupt byte string; store test that the cache is
  outside `objects/` and ignored by the index.
- **Files:** `Cargo.toml`, `routes/files.rs`, `store/fs.rs` if the cache helper needs it.

### Checkpoint 5 — Upload, file/image properties and record cover

- `api/types.ts` gains `file`/`image` and `cover`; `api/queries.ts` gains `useUploadFile` (raw body,
  name in the query) and the cover PATCH uses the existing object update.
- One shared `components/file-field.tsx`: drop zone/Choose file, busy state, size and type error,
  Retry, Remove; 44 px targets and 16 px fields on a coarse pointer.
- `property-input.tsx`/`property-field.tsx` render `file` and `image`: choose → upload → write the
  returned path; the previous value survives a failed upload; a failed write shows its sentence.
- `object-panel.tsx`: the cover hero above the title, Change/Remove in the overflow menu, and the
  `cover` field in the dirty/save/conflict path.
- **Acceptance:** choosing a PNG writes a path and the row shows its name; a refused upload leaves
  the old value and offers Retry; the cover appears after save and clears with Remove; keyboard and
  coarse-pointer paths both reach the picker.
- **Tests:** component tests with `stubFetch` for upload-then-PATCH and upload failure; no test for
  the OS file dialog.
- **Files:** `api/types.ts`, `api/queries.ts`, `components/file-field.tsx`,
  `property-input.tsx`, `property-field.tsx`, `object-panel.tsx`, `styles/globals.css` if the
  picker needs a token.

### Checkpoint 6 — Gallery covers and the lightbox

- `gallery-view.tsx`: an `image` cover property renders `<img>` with `?w=512`, `object-fit: cover`,
  a neutral placeholder while it loads, and the object cover as the fallback; non-image covers stay
  typographic.
- `components/image-lightbox.tsx` on the existing sheet primitives: close, Escape, focus return,
  caption; opened from a gallery tile, the record cover and an image property. A `file` value
  downloads instead.
- **Acceptance:** a gallery with an image cover shows images, not labels; a missing image keeps the
  tile's text; Escape closes the lightbox and returns focus to the tile; the lightbox fits 390 and
  does not scroll the page behind it.
- **Tests:** gallery render with an image value; lightbox Escape and focus return.
- **Files:** `gallery-view.tsx`, `image-lightbox.tsx`, `object-panel.tsx` (opener),
  `property-input.tsx` (opener), `styles/globals.css`.

### Checkpoint 7 — Lifecycle, GC, CSV and problems

- Purge runs the reference scan and removes unreferenced bytes and thumbnails; the owner GC route
  returns `{removed, freed_bytes}`; duplicate shares paths; trash keeps references.
- `problems().missing_files` and `GET /api/spaces/{space}/health` include the object, the field
  (`cover` or a property key) and the path; `/reindex` prints them.
- CSV export/import for file/image columns and a row-level error for a missing path.
- Backup docs: include `files/`, exclude `files/.thumbs/`.
- **Acceptance:** two records sharing a path keep the bytes when one is purged; purging the last
  reference removes the file and its thumbnails; a value removed from a record is collected only by
  GC, not by the PATCH; an external `rm` shows in the space health read and the record still opens; CSV
  round-trips a file path and refuses a missing one.
- **Tests:** store/index/server lifecycle tests over `TempDir`; CSV unit cases; `problems` case.
- **Files:** `store/fs.rs`, `routes/objects.rs`, `routes/files.rs`, `routes/spaces.rs` (space
  health), `routes/mod.rs` (`problems_json`), `csv.rs`, `index.rs`, `README.md`.

### Checkpoint 8 — Version, docs and release QA

- `web/package.json` and the changelog at `0.6.0`; changelog highlights for attachments, covers and
  thumbnails; the schema-5 sentence.
- `README.md`, `PRODUCT.md`, `DESIGN.md`, `AGENTS.md`: the `files/` layout; the backup rule,
  including AGENTS's "the space content is only markdown" sentence, which becomes false once bytes
  live under `files/`; the new formats; the cover and lightbox surfaces; `FORMAT_VERSION` 5; and
  the M6 plan row.
- QA: contact sheet at 390 / 768 / 1024 / 1440 in both schemes over a type with an image and a file
  column, a record with a cover, the gallery, the palette/capture sheets, schema, trash and space
  settings; overflow, contrast, reduced motion and a keyboard traversal of the record and lightbox;
  a real upload/download cycle through the API and the browser.
- **Acceptance:** the changelog's top entry reads `0.6.0`; the space health read reports no missing
  files in the seeded space; every gate passes; the release QA sheet is stored in
  `.impeccable/critique/`.
- **Files:** `web/package.json`, `web/src/content/changelog.ts`, `README.md`, `PRODUCT.md`,
  `DESIGN.md`, `AGENTS.md`, the QA document.

## 6. Manual QA matrix

| # | Route / surface | Action | Expected |
|---|---|---|---|
| 1 | `/s/<space>/schema?type=<t>` | Add an `image` property, then a `file` property | Both appear in the table header and the record margin |
| 2 | Record | Choose a PNG in the image property | Row shows a thumbnail and the filename; the value survives reload |
| 3 | Record | Choose a PDF in the file property | Row shows the filename; clicking downloads it |
| 4 | Record menu | Add cover, choose a PNG | 16:9 hero above the title; Remove clears it; history names the change |
| 5 | `/s/<space>/t/<t>?view=<gallery>` | Set the view cover to the image property | Tiles draw images; a record without one keeps its text tile |
| 6 | Gallery / record | Click an image | Lightbox opens; Escape returns focus to the opener; 390 fits |
| 7 | DevTools Network | Upload over 10 MiB | A sentence names the limit; the previous value stays |
| 8 | API | `POST …/files?name=../x.png` | `400`; no file outside `files/` |
| 9 | API | Same bytes and name twice | `200`; one file on disk |
| 10 | Record | `rm` the file on disk, reload | Record still opens; the space health read names the object and path |
| 11 | Trash | Restore a record with a cover | Cover still renders; no bytes were copied |
| 12 | Two records | Share one path; purge one, then the other | First purge keeps the file; second removes it and its thumbnails |
| 13 | CSV | Export a file column, import it unchanged | Path preserved; a missing path is a row error |
| 14 | Backup | `tar` the space, exclude `files/`, restore | Images 404 until bytes are restored; the space health read reports the missing files |
| 15 | Phone 390, touch | Choose a file, open the lightbox | 44 px controls; picker and lightbox clear the keyboard; no page overflow |

## 7. Decisions taken while scoping

1. **One path grammar, content-addressed.** `files/<sha256>/<name>`; a file's bytes determine its
   directory, its name stays readable. Same path means same bytes.
2. **A file value is text, not a mapping.** `Value` is untagged and already has one mapping shape;
   a second mapping would be an ambiguous deserialization and a duplicate source of truth.
3. **`cover` is a reserved frontmatter key, not a property.** It is secondary display, like
   `icon`, and belongs to the object, not the type's schema.
4. **Raw bytes, not multipart.** It removes a parser and a dependency; the client already controls
   the filename and the server sniffs the type.
5. **Thumbnails are derived, lazy and outside the backup.** A restored space repairs its thumbnails
   on first view; the canonical tarball stays smaller.
6. **GC is explicit plus purge.** Removing a value from a record does not scan the space; the owner
   GC and purge do. This keeps ordinary writes fast and gives storage an honest cleanup path.
7. **No body images in M6.** It is a different surface (markdown insertion, rendering and paste);
   the owner confirmed it as the M6.1 follow-up (§8).
8. **SVG is refused.** It is script-bearing XML; serving it as an image or a navigable file is more
   risk than an image attachment is worth.
9. **10 MiB per file, no space quota.** The limit is named in the error; a self-hosted install owns
   its disk.
10. **No range requests.** M6 is images and ordinary files, not a media server.
11. **Board cards stay typographic.** Only the gallery and the record hero gain images in M6.
12. **Two names are two paths.** Identical bytes under different names are stored twice; no name
    manifest or byte-level dedupe indirection.
13. **The record cover is 16:9.** The gallery uses an image cover property with the object cover as
    its fallback.
14. **Files are member-only.** No public or signed URL in M6; that is a permission model, not an
    attachment detail.
15. **AVIF and video are out.** M6 decodes PNG, JPEG, WebP and GIF and serves ordinary files; no
    media player and no range requests.

## 8. Questions resolved 2026-11-05

| # | Question | Answer |
|---|---|---|
| 1 | SVG uploads | **Refuse SVG.** It is script-bearing XML; it never enters the image path. |
| 2 | Body images | **M6.1 follow-up.** M6 ships frontmatter files, properties and covers only. |
| 3 | Record cover shape | **16:9.** |
| 4 | AVIF and video | **Skip both.** PNG/JPEG/WebP/GIF images; no media player, no range requests. |
| 5 | Unused-file GC | **Owner route plus purge.** Routine writes never scan the space. |
| 6 | Board cards | **Keep typographic.** Only the gallery and the record hero gain images in M6. |
| 7 | Same bytes under different names | **Two paths, two copies.** The path stays the fact; no name manifest. |
| 8 | Public or signed file URLs | **No, member-only.** Sharing is a later permission model. |

No open questions remain for M6. If implementation finds a new one, stop and ask the owner; do not
decide it inside a checkpoint. M6.1 (body images) is the only committed follow-up and is not part
of this milestone's version.

## 9. Release checklist

0. Re-read `AGENTS.md` and confirm the working tree contains only this checkpoint's changes; the
   fixed dev account and `./data` are untouched.
1. `cd web && npm run test:run && npm run lint && npm run typecheck && npm run build`
2. `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings &&
   cargo test --workspace`
3. Fixtures: a valid schema-5 `object_files.md`; `invalid/schema_6.md`; every schema-1…4 fixture
   still parses; `roundtrip.rs` is byte-for-byte.
4. `web/package.json` and `web/src/content/changelog.ts` both read `0.6.0`; the top entry is the
   release, not `Unreleased`.
5. Manual QA matrix §6, including a real upload/download and a backup restore.
6. Docs agree: README backup line, PRODUCT's canonical-store claim, DESIGN's image surfaces,
   AGENTS's `FORMAT_VERSION` and plan row.
7. The release QA sheet is stored beside the critique it belongs to; the tag is cut by the owner
   after review, never by the agent.

## 10. What M7 inherits

- A content-addressed `files/` tree, a path grammar and a hash in every upload response.
- File references that survive trash, restore, duplicate and purge, with missing bytes reported
  rather than hidden.
- Thumbnails as a derived cache, so a desktop client can ignore them and rebuild locally.
- A read/write contract with role checks and bounded sizes that the sync layer can reuse rather
  than re-invent.
- The open iPhone gate: M6 adds a file picker and a lightbox on the phone shell, and emulation alone
  does not prove the iOS picker or the keyboard interaction.
