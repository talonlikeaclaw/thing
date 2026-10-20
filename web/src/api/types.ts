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
