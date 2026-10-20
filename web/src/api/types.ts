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
