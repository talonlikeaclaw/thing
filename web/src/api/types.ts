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
  | "recurrence";

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

/** One row of a view. `values` holds the selected view's fields minus `title`. */
export interface ObjectSummary {
  id: Uuid;
  type: string;
  title: string;
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

export interface ObjectDetail {
  id: Uuid;
  type: string;
  title: string;
  rev: number;
  created_at: IsoDate;
  updated_at: IsoDate;
  created_by: Uuid;
  updated_by: Uuid;
  properties: Record<string, ValueJson>;
  body: string;
  missing_relations: Uuid[];
  /** Timing for a scheduled type; absent on every other type. */
  schedule?: ScheduleState;
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
  overdue: AgendaRow[];
  due_today: AgendaRow[];
  upcoming: AgendaRow[];
  later_count: number;
}

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

/** The title and every property a write left behind. */
export interface RevisionSnapshot {
  title: string;
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

/** One trashed record; the file and its history survive until purged. */
export interface TrashItem {
  id: Uuid;
  type: string;
  title: string;
  rev: number;
  trashed_at: IsoDate | null;
  trashed_from?: string;
}
