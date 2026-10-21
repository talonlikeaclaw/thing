# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Rust workspace: `thing-core` (pure domain, format, validation, query, store) linked by
`thing-server` (axum HTTP shell). Frontend is a Vite + React 19 SPA with Tailwind v4 and Base UI,
speaking to the server over same-origin cookies and a WebSocket. Accounts live in a single SQLite
file; space content lives in markdown files on disk. A Tauri desktop shell and a CLI/MCP server are
later binaries over the same core. The stack is a fixed decision, not an open question.

## Users

One owner who self-hosts the app and defines the schema, plus the collaborators they invite into a
shared space. Both are comfortable with the mental model of a spreadsheet or a small database —
tables, columns, rows, cells — but not with code. They should never have to learn a query language,
a migration step, or a file format to use the product.

## Product Purpose

Let a person define their own types and properties, create records of those types, and track them
over time, then share that structure with other people who see changes live. It exists because
purpose-built tracking apps force someone else's schema; here the schema is the user's, and it can
change without losing data. Success means a non-coding collaborator can create a type and a
record without being taught, and the owner's existing plant and chore trackers can be rebuilt as
ordinary spaces through the generic CSV path rather than a bespoke importer.

## Positioning

The data is plain markdown files with YAML frontmatter on the filesystem, so backups, grep, git,
diff and export come free and the store is portable: copy a space directory anywhere and it still
knows its own schema, members and records. Structure is separated from prose — properties carry the
structure, one markdown body carries the writing. The bundled schema is powerful through the Excel
model rather than through a query language. A hosted knowledge tool could not truthfully copy the
"your files are the database" claim; a file-based notes tool could not offer the typed tables,
relations and live collaboration.

## Operating Context

The owner runs the server on their own hardware (a homelab container) behind a private tunnel and
opens it in a browser. Collaborators are invited by link and join a space at a role. The owner will
also edit the markdown files directly in their own editor and expect the running app to notice and
reflect those edits rather than serving or overwriting stale state. An omp agent may later drive
the app through tokens and an MCP server the way it drives a self-hosted Anytype today.

## Capabilities and Constraints

Milestone 1 (the engine core) delivers: user accounts, sessions and invites; spaces with owner,
editor and viewer roles; user-defined types and properties with a defined set of formats (text,
number, checkbox, date, datetime, select, multi-select, url, email, relation); object create, read,
update, delete with a markdown body; a live per-type table view with filters and sorts; read-only
history; trash with restore and purge; external file edits noticed and reflected; a seed script;
CI; and a container.

Durable constraints: object identity is a UUIDv7 in frontmatter so renaming, retyping or moving a
file never breaks a link; property and type keys are lowercase slugs unique per space and are what
frontmatter stores, never a display name; an unset value is an absent key, never `null`, `""` or
`[]`; a relation whose target is gone is kept and surfaced, never dropped; writes are atomic;
there is exactly one spelling for every concept, with no aliases or compatibility shims; and a
file whose `schema` version the reader does not understand is refused loudly rather than guessed
at. Space content never lives in a database — only accounts, sessions and invites do.

## Brand Commitments

The working name is **thing**, lowercase, in the same family as the owner's existing product
`chore`. Renaming later is a mechanical find/replace over the identifiers and the container name,
so the name is not load-bearing. The interface should read as a file-backed, structured-data tool
in the family of the owner's other products: dense, legible, and calm rather than decorated.

## Evidence on Hand

No screenshots, testimonials or marketing assets exist, and none should be fabricated. The real
evidence is the two source projects the owner already runs (`plant-tracker` and `chore`, both
Postgres-backed): their schemas prove the type/property model fits real tracking data. They are
rebuilt with CSV import or by hand; there are no source-specific importer milestones.

## Product Principles

1. **Your data outlives the app.** The canonical store is files a person can read, diff, back up
   and walk away with. Every feature must survive the app being deleted.
2. **The model is Excel, made powerful.** Type, property, object, value map onto table, column, row,
   cell. Power comes from types, relations and views, never from a query language or a mode.
3. **Identity is stable, names are free.** Objects are addressed by UUID and referenced by key, so
   renaming anything — a type, a property, an option's label, a file — never breaks a link.
4. **Never lose what you were given.** A dangling relation, an unparsed file, a conflicting write:
   keep it and surface it. Silent data loss is the one unforgivable failure.
5. **One spelling for everything.** One filter format, one empty-value convention, one way to
   address an object. No parallel grammars, no shims, no compatibility modes to reason about.

## Accessibility & Inclusion

No product-specific standard was established beyond the visual direction's working rules: density
follows the input method rather than the viewport, so coarse pointers get large enough targets and
16px inputs that a phone does not zoom a focused field; and any state the product relies on colour
to show must also be legible as text.
