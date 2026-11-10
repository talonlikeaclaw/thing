/** TypeScript mirrors of the Rust DTOs the SPA speaks to. */

export type Uuid = string;
/** RFC 3339 UTC, as the server writes it. */
export type IsoDate = string;

export type Role = "owner" | "editor" | "viewer";

export interface User {
  id: Uuid;
  email: string;
  name: string;
}

export interface Member {
  user: Uuid;
  name: string;
  email: string | null;
  role: Role;
}

export interface SpaceSummary {
  id: Uuid;
  name: string;
  icon: string | null;
  role: Role;
  member_count: number;
  type_count: number;
}

export interface SpaceDetail {
  id: Uuid;
  name: string;
  icon: string | null;
  /** One of the six preset ids; null means Lichen. */
  accent: string | null;
  timezone: string;
  created_at: IsoDate;
  role: Role;
  members: Member[];
  type_count: number;
}

export interface Session {
  user: User;
  spaces: SpaceSummary[];
}

export type PropertyFormat =
  | "text"
  | "number"
  | "checkbox"
  | "date"
  | "datetime"
  | "select"
  | "multi_select"
  | "url"
  | "email"
  | "relation"
  | "recurrence"
  | "file"
  | "image"
  | "attachments"
  | "list";

export type ComputeKind = "formula" | "rollup";

export type Aggregate = "count" | "sum" | "min" | "max" | "list";

/**
 * A property's derivation. `format` stays the result type, so a computed number
 * sorts, filters, renders and exports like a stored one.
 */
export interface ComputeDef {
  kind: ComputeKind;
  /** A formula expression; present only for `formula`. */
  expression?: string;
  /** The stored relation a rollup reads; `rollup` only. */
  relation?: string;
  /** The property the rollup reads on each target; `rollup` only, not `count`. */
  property?: string;
  /** The rollup's aggregate; `rollup` only. */
  aggregate?: Aggregate;
}

export interface OptionDef {
  /** Stable identity: renaming the display name never moves a stored value. */
  key: string;
  name: string;
  color: string;
}

export interface PropertyDef {
  key: string;
  name: string;
  format: PropertyFormat;
  /** Present only for `select` and `multi_select`; omitted when empty. */
  options?: OptionDef[];
  /** Present only for `relation`; omitted when any type is allowed. */
  target_type?: string | null;
  /** `relation` only: the value holds several target ids. */
  multi?: boolean;
  /** Present when the app derives this property's value; the server never stores it. */
  compute?: ComputeDef;
}

/** A property's membership in a type. */
export interface TypeProperty {
  key: string;
  required: boolean;
  featured: boolean;
}

export type SortDirection = "asc" | "desc";
export type EmptyPlacement = "start" | "end";

export interface Sort {
  property: string;
  direction: SortDirection;
  empty?: EmptyPlacement;
}

export type FilterOp = "and" | "or";

export type CondOp =
  | "equal"
  | "not_equal"
  | "greater"
  | "less"
  | "greater_or_equal"
  | "less_or_equal"
  | "contains"
  | "not_contains"
  | "in"
  | "not_in"
  | "all_in"
  | "is_empty"
  | "is_not_empty";

export interface Condition {
  property: string;
  condition: CondOp;
  value?: unknown;
}

export interface Filter {
  op: FilterOp;
  conditions: Condition[];
}

export type ViewKind = "table" | "board" | "gallery" | "calendar";

/** One named saved view; every field belongs to the type file on disk. */
export interface ViewDef {
  /** Stable slug minted from the name at creation. */
  key: string;
  name: string;
  kind: ViewKind;
  sorts: Sort[];
  filter: Filter;
  /** `title` first, then property keys in display order; empty only for calendar. */
  columns: string[];
  /** Table widths in CSS pixels; absent means the renderer's default. */
  widths?: Record<string, number>;
  /** `board` only: the select property whose options are lanes. */
  group_by?: string;
  /** `gallery` only: the property label on the cover tile. */
  cover?: string;
  /** `calendar` only: the date property that places a record on a day. */
  date_property?: string;
}

/** A new view; omitted layout and query fields copy the current default view. */
export interface CreateView {
  name: string;
  kind: ViewKind;
  filter?: Filter;
  sorts?: Sort[];
  columns?: string[];
  widths?: Record<string, number>;
  group_by?: string;
  cover?: string;
  date_property?: string;
}

/** The mutable subset of a view; `kind` and `key` never change. */
export interface UpdateView {
  name?: string;
  filter?: Filter;
  sorts?: Sort[];
  columns?: string[];
  widths?: Record<string, number>;
  group_by?: string;
  /** `null` clears the cover. */
  cover?: string | null;
  date_property?: string;
}

export type RecurrenceKind = "days" | "weekly" | "monthly";

/** A recurrence mapping as frontmatter and JSON carry it. */
export interface RecurrenceValue {
  kind: RecurrenceKind;
  every: number;
  /** `0`=Sunday through `6`=Saturday; `weekly` only. */
  weekday?: number;
  /** `1..=31`; `monthly` only. */
  day?: number;
}

export type ScheduleStatus = "unscheduled" | "done" | "overdue" | "today" | "upcoming";

/** The server-derived timing of one scheduled record. */
export interface ScheduleState {
  due_date?: string;
  status: ScheduleStatus;
  days_until_due?: number;
  completed_at?: IsoDate;
}

/** Per-type display names for generated schedule properties; keys never move. */
export interface ScheduleLabels {
  due?: string;
  recurrence?: string;
  last_completed?: string;
  /** The button that records a completion, for example "Water". */
  complete?: string;
}

export interface TypeDef {
  key: string;
  name: string;
  name_plural: string;
  icon?: string | null;
  description: string;
  schedule: boolean;
  /** Omitted when every generated property keeps its default name. */
  schedule_labels?: ScheduleLabels;
  /** The generated schedule definitions; omitted when the type is not scheduled. */
  implicit_properties?: PropertyDef[];
  properties: TypeProperty[];
  /** Ordered saved views; a type always has at least one. */
  views: ViewDef[];
  default_view: string;
}

export interface TypeSummary {
  key: string;
  name: string;
  name_plural: string;
  icon?: string | null;
  description: string;
  schedule: boolean;
  property_count: number;
  object_count: number;
}

/** One value as the server renders it: raw for comparison, label for display. */
export interface ValueJson {
  value: unknown;
  label: string;
  /** Relation values only: at least one target is not in the space. */
  missing?: boolean;
}

/** One stored attachment, as the upload route answers. */
export interface UploadedFile {
  /** The POSIX-relative path a file or image value stores. */
  path: string;
  hash: string;
  /** The stored name: a slugged stem and the sniffed or original extension. */
  name: string;
  mime: string;
  size: number;
}

/** One live or trashed record that names a stored file. */
export interface LibraryRecord {
  id: Uuid;
  rev: number;
  title: string;
  icon: string | null;
  type_key: string;
  type_name: string;
  /** `cover`, `body` or the property key that names the bytes. */
  field: string;
  /** `Cover`, `Body` or the property's label. */
  field_name: string;
  trashed: boolean;
  updated_at: string;
}

/** One stored attachment with the records that name it. */
export interface LibraryItem {
  /** The canonical path, `files/<sha256>/<name>`. */
  path: string;
  /** The stored file name, without its hash directory. */
  name: string;
  size: number;
  kind: "image" | "file";
  /** No live or trashed record, cover or body names these bytes. */
  unused: boolean;
  records: LibraryRecord[];
}

/** The space's whole attachment tree, as the library reads it. */
export interface Library {
  items: LibraryItem[];
  total_bytes: number;
  unused_bytes: number;
}

/** One row of a view. `values` holds the selected view's fields minus `title`. */
export interface ObjectSummary {
  id: Uuid;
  type: string;
  title: string;
  /** A user-authored glyph; absent when the record has none. */
  icon?: string;
  /** The 16:9 cover image's path; absent when the record has none. */
  cover?: string;
  /** The cover's focal point, `"<x>% <y>%"`; absent means the centre. */
  cover_position?: string;
  rev: number;
  updated_at: IsoDate;
  values: Record<string, ValueJson>;
  missing_relations: Uuid[];
  /** Timing for a scheduled type; absent on every other type. */
  schedule?: ScheduleState;
}

export interface ObjectList {
  /** The view the server projected the rows through. */
  view: string;
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
  objects: ObjectSummary[];
}

/** One ranked hit from the space-wide search read. */
export interface SearchResult {
  id: Uuid;
  type: string;
  type_name: string;
  type_icon?: string;
  title: string;
  icon?: string;
  updated_at: IsoDate;
  score: number;
  /** The sentence around the first body match; absent for a title-only hit. */
  snippet?: string;
}

export interface SearchResponse {
  query: string;
  /** Every match, before the page limit. */
  total: number;
  results: SearchResult[];
}

export interface ObjectDetail {
  id: Uuid;
  type: string;
  title: string;
  /** A user-authored glyph; absent when the record has none. */
  icon?: string;
  /** The 16:9 cover image's path; absent when the record has none. */
  cover?: string;
  /** The cover's focal point, `"<x>% <y>%"`; absent means the centre. */
  cover_position?: string;
  rev: number;
  created_at: IsoDate;
  updated_at: IsoDate;
  created_by: Uuid;
  updated_by: Uuid;
  properties: Record<string, ValueJson>;
  body: string;
  missing_relations: Uuid[];
  /** Outgoing `[[type/Title]]` links; present when the read asks for them. */
  links?: ObjectLink[];
  /** Resolved records this one points at; present with `with=links`. */
  links_to?: OutgoingLink[];
  /** Records that point here; present when the read asks for them. */
  backlinks?: Backlink[];
  /** Timing for a scheduled type; absent on every other type. */
  schedule?: ScheduleState;
}

export type LinkStatus = "ok" | "unknown" | "ambiguous";

/** One distinct `[[type/Title]]` in a body, resolved or not. */
export interface ObjectLink {
  /** The trimmed text between the brackets, as typed. */
  raw: string;
  type: string;
  title: string;
  status: LinkStatus;
  /** Present only when the link resolves. */
  id?: Uuid;
}

export interface RelationBacklink {
  kind: "relation";
  id: Uuid;
  type: string;
  type_icon?: string;
  title: string;
  icon?: string;
  /** The property key that points here. */
  property: string;
  property_name: string;
}

export interface MentionBacklink {
  kind: "mention";
  id: Uuid;
  type: string;
  type_icon?: string;
  title: string;
  icon?: string;
  /** The sentence around the first link. */
  snippet: string;
  count: number;
}

export type Backlink = RelationBacklink | MentionBacklink;

/** An outgoing relation or mention, with the target's display facts. */
export interface OutgoingRelationLink {
  kind: "relation";
  id: Uuid;
  type: string;
  type_icon?: string;
  title: string;
  icon?: string;
  /** The property key that points at the target. */
  property: string;
  property_name: string;
}

export interface OutgoingMentionLink {
  kind: "mention";
  id: Uuid;
  type: string;
  type_icon?: string;
  title: string;
  icon?: string;
}

export type OutgoingLink = OutgoingRelationLink | OutgoingMentionLink;

/** One record in the whole-space graph. */
export interface SpaceGraphNode {
  id: Uuid;
  type: string;
  title: string;
  icon?: string;
}

/** One resolved connection; a relation and a body link share a pair. */
export interface SpaceGraphEdge {
  source: Uuid;
  target: Uuid;
  kind: "relation" | "mention";
  mention: boolean;
}

/** Every live record and every resolved connection in one space. */
export interface SpaceGraph {
  nodes: SpaceGraphNode[];
  edges: SpaceGraphEdge[];
}

/** One live record's most recent write, with the keys that write changed. */
export interface ActivityEntry {
  id: Uuid;
  type: string;
  title: string;
  icon?: string;
  action: RevisionAction;
  at: IsoDate;
  by: Uuid;
  rev: number;
  /** `title`, `body` and every property key the last write changed. */
  changed: string[];
}

/** Most recently written records, newest first. */
export interface SpaceActivity {
  entries: ActivityEntry[];
}

/** One row of the Schedule page; the server owns its bucket. */
export interface AgendaRow {
  id: Uuid;
  type: string;
  type_name: string;
  type_icon?: string | null;
  title: string;
  rev: number;
  due_date: string;
  status: ScheduleStatus;
  days_until_due: number;
  recurrence?: string;
  last_completed_at?: IsoDate;
}

export interface Agenda {
  today: string;
  timezone: string;
  rows: AgendaRow[];
  /** Present in window mode: outstanding rows due beyond the horizon. */
  later_count?: number;
  /** Present in range mode: the inclusive bounds the server applied. */
  from?: string;
  to?: string;
}

/**
 * The agenda read is either a horizon window (`days`) or an explicit inclusive
 * range (`from`/`to`); never both. `types` narrows either to scheduled keys.
 */
export type AgendaQuery = ({ days?: number } | { from: string; to: string }) & {
  types?: string[];
};

/** The query the table sends; `filter` and `sorts` are already effective. */
export interface ObjectsQuery {
  type: string;
  /** The saved view to project; omitted means the type's default. */
  view?: string;
  filter?: Filter;
  sorts?: Sort[];
  q?: string;
  limit?: number;
  offset?: number;
}

export type RevisionAction = "create" | "update" | "delete" | "restore" | "complete";

/** The title, optional icon and every property a write left behind. */
export interface RevisionSnapshot {
  title: string;
  /** Absent on lines written before the field existed, and when no icon is set. */
  icon?: string;
  /** Absent when the record had no cover at that revision. */
  cover?: string;
  /** The focal point in effect at that revision; absent means the centre. */
  cover_position?: string;
  properties: Record<string, unknown>;
}

/** One line of an object's history. `body` is present only when that write changed it. */
export interface Revision {
  rev: number;
  at: IsoDate;
  by: Uuid;
  action: RevisionAction;
  snapshot: RevisionSnapshot;
  body?: string;
  /** `title`, `body` and every property key this write added, altered or dropped. */
  changed: string[];
}

/** The outcome of one in-place write; a refusal keeps the editor on screen. */
export interface WriteResult {
  ok: boolean;
  message?: string;
}

/** One reason a CSV file was refused; `row` 0 means the file or header. */
export interface CsvProblem {
  row: number;
  field: string;
  message: string;
}

/** A valid row a dry run previews, already converted to typed values. */
export interface CsvPreviewRow {
  row: number;
  title: string;
  values: Record<string, unknown>;
}

/** The result of a dry run: counts, every problem, and at most 20 valid rows. */
export interface CsvPreview {
  rows: number;
  valid: boolean;
  errors: CsvProblem[];
  preview: CsvPreviewRow[];
}

/** What a committed import created. */
export interface CsvImportResult {
  count: number;
  created: { id: Uuid; title: string }[];
}

/** Duplicate takes the source id and an optional title override. */
export interface DuplicateObjectInput {
  id: Uuid;
  title?: string;
}

/** An invite code and its redemption state; the code is the join URL's tail. */
export interface Invite {
  code: string;
  role: Role;
  created_at: IsoDate;
  expires_at: IsoDate | null;
  used_at: IsoDate | null;
}

/** What creating an invite returns; the URL is absolute from the server config. */
export interface CreateInviteResult {
  code: string;
  url: string;
  expires_at: IsoDate | null;
}

/** One trashed record; the file and its history survive until purged. */
export interface TrashItem {
  id: Uuid;
  type: string;
  title: string;
  icon?: string;
  rev: number;
  trashed_at: IsoDate | null;
  trashed_from?: string;
}

/** The four staged requests of a column promotion. */
export type PromoteStage = "plan" | "targets" | "links" | "finish";

/** The new type and relation a promotion asks for. */
export interface PromoteTargetInput {
  name: string;
  name_plural?: string;
  icon?: string;
}

/** One promotion request; `target_type` resumes a run that already made the type. */
export interface PromoteRequest {
  stage: PromoteStage;
  property: string;
  target: PromoteTargetInput;
  target_type?: string;
  relation_name: string;
  multi: boolean;
  /** A text delimiter; text columns only. */
  split?: string;
}

export interface PromoteSource {
  type_key: string;
  key: string;
  name: string;
  format: PropertyFormat;
  split?: string;
  records: number;
  distinct: number;
  empty: number;
}

export interface PromoteValue {
  title: string;
  records: number;
  exists: boolean;
}

export interface PromoteTarget {
  key: string;
  name: string;
  name_plural: string;
  icon?: string | null;
  create: boolean;
  values: PromoteValue[];
  create_records: number;
}

export interface PromoteRelation {
  key: string;
  name: string;
  multi: boolean;
}

export interface PromoteView {
  key: string;
  name: string;
  columns: boolean;
  sorts: number;
  filters_moved: number;
  filters_dropped: number;
}

/** The read-only preview: every count, warning and blocking reason. */
export interface PromotePlan {
  source: PromoteSource;
  target: PromoteTarget;
  relation: PromoteRelation;
  links: number;
  views: PromoteView[];
  warnings: string[];
  blocking: string[];
}

export interface PromoteTargetsResult {
  type: string;
  type_created: boolean;
  created: number;
  records: { id: Uuid; title: string; exists: boolean }[];
}

export interface PromoteLinksResult {
  property: string;
  created: boolean;
  links: number;
  filters_dropped: number;
  views: PromoteView[];
}

export interface PromoteFinishResult {
  key: string;
  finished: boolean;
}
