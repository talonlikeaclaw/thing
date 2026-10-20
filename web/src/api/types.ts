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
  | "relation";

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

export interface ViewDef {
  sorts: Sort[];
  filter: Filter;
  /** `title` first, then property keys in display order. */
  columns: string[];
}

export interface TypeDef {
  key: string;
  name: string;
  name_plural: string;
  icon?: string | null;
  description: string;
  properties: TypeProperty[];
  view: ViewDef;
}

export interface TypeSummary {
  key: string;
  name: string;
  name_plural: string;
  icon?: string | null;
  description: string;
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

/** One row of a type's table. `values` holds the view columns minus `title`. */
export interface ObjectSummary {
  id: Uuid;
  type: string;
  title: string;
  rev: number;
  updated_at: IsoDate;
  values: Record<string, ValueJson>;
  missing_relations: Uuid[];
}

export interface ObjectList {
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
}

/** The query the table sends; `filter` and `sorts` are already effective. */
export interface ObjectsQuery {
  type: string;
  filter?: Filter;
  sorts?: Sort[];
  q?: string;
  limit?: number;
  offset?: number;
}
