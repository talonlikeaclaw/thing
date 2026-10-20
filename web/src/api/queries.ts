import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { isUnauthenticated, request } from "@/api/client";
import type {
  PropertyDef,
  PropertyFormat,
  SpaceDetail,
  SpaceSummary,
  Session,
  TypeDef,
  TypeProperty,
  TypeSummary,
  User,
  ViewDef,
} from "@/api/types";

export const queryKeys = {
  me: ["me"] as const,
  spaces: ["spaces"] as const,
  space: (id: string) => ["space", id] as const,
  types: (id: string) => ["space", id, "types"] as const,
  type: (id: string, key: string) => ["space", id, "type", key] as const,
  properties: (id: string) => ["space", id, "properties"] as const,
};

/** The signed-in user, or `null` when the request had no live session. */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async (): Promise<User | null> => {
      try {
        return await request<User>("/api/auth/me");
      } catch (error) {
        if (isUnauthenticated(error)) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
}

export function useSpaces(enabled = true) {
  return useQuery({
    queryKey: queryKeys.spaces,
    queryFn: () => request<SpaceSummary[]>("/api/spaces"),
    enabled,
  });
}

export function useSpace(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.space(id ?? ""),
    queryFn: () => request<SpaceDetail>(`/api/spaces/${id}`),
    enabled: Boolean(id),
  });
}

interface Credentials {
  email: string;
  password: string;
}

interface Registration extends Credentials {
  name: string;
  invite?: string;
}

/** Every auth success seeds the same two caches, so a reload is not needed. */
function useSessionMutation<TInput>(path: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) => request<Session>(path, { method: "POST", body: input }),
    onSuccess: (session) => {
      client.setQueryData(queryKeys.me, session.user);
      client.setQueryData(queryKeys.spaces, session.spaces);
    },
  });
}

export function useLogin() {
  return useSessionMutation<Credentials>("/api/auth/login");
}

export function useRegister() {
  return useSessionMutation<Registration>("/api/auth/register");
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => request<void>("/api/auth/logout", { method: "POST" }),
    onSettled: () => {
      client.removeQueries({ queryKey: queryKeys.me });
      client.removeQueries({ queryKey: queryKeys.spaces });
      client.clear();
    },
  });
}

interface NewSpace {
  name: string;
  icon?: string;
}

export function useCreateSpace() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: NewSpace) =>
      request<SpaceDetail>("/api/spaces", { method: "POST", body: input }),
    onSuccess: (space) => {
      client.setQueryData(queryKeys.space(space.id), space);
      void client.invalidateQueries({ queryKey: queryKeys.spaces });
    },
  });
}

export function useTypes(spaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.types(spaceId ?? ""),
    queryFn: () => request<TypeSummary[]>(`/api/spaces/${spaceId}/types`),
    enabled: Boolean(spaceId),
  });
}

export function useType(spaceId: string | undefined, key: string | undefined) {
  return useQuery({
    queryKey: queryKeys.type(spaceId ?? "", key ?? ""),
    queryFn: () => request<TypeDef>(`/api/spaces/${spaceId}/types/${key}`),
    enabled: Boolean(spaceId && key),
  });
}

export function useProperties(spaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.properties(spaceId ?? ""),
    queryFn: () => request<PropertyDef[]>(`/api/spaces/${spaceId}/properties`),
    enabled: Boolean(spaceId),
  });
}

export interface NewType {
  name: string;
  name_plural?: string;
  icon?: string;
  description?: string;
}

export interface UpdateType {
  name?: string;
  name_plural?: string;
  /** `null` clears the icon; omitting the field leaves it alone. */
  icon?: string | null;
  description?: string;
  properties?: TypeProperty[];
  view?: ViewDef;
}

/** Every schema write can change counts and definitions, so refresh the space. */
function useSchemaMutation<TInput, TResult>(
  spaceId: string,
  mutationFn: (input: TInput) => Promise<TResult>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.space(spaceId) }),
  });
}

export function useCreateType(spaceId: string) {
  return useSchemaMutation<NewType, TypeDef>(spaceId, (input) =>
    request<TypeDef>(`/api/spaces/${spaceId}/types`, { method: "POST", body: input }),
  );
}

export function useUpdateType(spaceId: string, key: string) {
  return useSchemaMutation<UpdateType, TypeDef>(spaceId, (input) =>
    request<TypeDef>(`/api/spaces/${spaceId}/types/${key}`, {
      method: "PATCH",
      body: input,
    }),
  );
}

/** One option as a write takes it; the key is absent only for a new option. */
export interface OptionInput {
  key?: string;
  name: string;
  color?: string;
}

export interface NewProperty {
  name: string;
  format: PropertyFormat;
  options?: OptionInput[];
  target_type?: string;
  multi?: boolean;
}

export interface UpdateProperty {
  name?: string;
  options?: OptionInput[];
}

export function useCreateProperty(spaceId: string) {
  return useSchemaMutation<NewProperty, PropertyDef>(spaceId, (input) =>
    request<PropertyDef>(`/api/spaces/${spaceId}/properties`, {
      method: "POST",
      body: input,
    }),
  );
}

export function useUpdateProperty(spaceId: string, key: string) {
  return useSchemaMutation<UpdateProperty, PropertyDef>(spaceId, (input) =>
    request<PropertyDef>(`/api/spaces/${spaceId}/properties/${key}`, {
      method: "PATCH",
      body: input,
    }),
  );
}

