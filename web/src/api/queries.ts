import { useMutation, useQuery, useQueryClient, useQueries } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { ApiError, isUnauthenticated, request } from "@/api/client";
import type {
  ObjectDetail,
  ObjectList,
  ObjectsQuery,
  PropertyDef,
  PropertyFormat,
  SpaceDetail,
  SpaceSummary,
  Session,
  TypeDef,
  TypeProperty,
  TypeSummary,
  User,
  ValueJson,
  ViewDef,
} from "@/api/types";

export const queryKeys = {
  me: ["me"] as const,
  spaces: ["spaces"] as const,
  space: (id: string) => ["space", id] as const,
  types: (id: string) => ["space", id, "types"] as const,
  type: (id: string, key: string) => ["space", id, "type", key] as const,
  properties: (id: string) => ["space", id, "properties"] as const,
  objects: (id: string, query: ObjectsQuery) => ["space", id, "objects", query] as const,
  objectsPrefix: (id: string) => ["space", id, "objects"] as const,
  relation: (id: string, type: string) => ["space", id, "relation", type] as const,
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

/** The list endpoint always takes its query in the URL; an empty filter is unfiltered. */
function objectsPath(spaceId: string, query: ObjectsQuery): string {
  const params = new URLSearchParams({ type: query.type });
  if (query.filter) {
    params.set("filter", JSON.stringify(query.filter));
  }
  if (query.sorts) {
    params.set("sorts", JSON.stringify(query.sorts));
  }
  if (query.q) {
    params.set("q", query.q);
  }
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  if (query.offset !== undefined) {
    params.set("offset", String(query.offset));
  }
  return `/api/spaces/${spaceId}/objects?${params}`;
}

export function useObjects(spaceId: string | undefined, query: ObjectsQuery | undefined) {
  return useQuery({
    queryKey: queryKeys.objects(spaceId ?? "", query ?? { type: "" }),
    queryFn: () => request<ObjectList>(objectsPath(spaceId ?? "", query ?? { type: "" })),
    enabled: Boolean(spaceId && query?.type),
    placeholderData: (previous) => previous,
  });
}

export interface CreateObjectInput {
  type: string;
  title: string;
  properties?: Record<string, unknown>;
  body?: string;
}

export function useCreateObject(spaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateObjectInput) =>
      request<ObjectDetail>(`/api/spaces/${spaceId}/objects`, { method: "POST", body: input }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.objectsPrefix(spaceId) });
      void client.invalidateQueries({ queryKey: queryKeys.space(spaceId) });
      void client.invalidateQueries({ queryKey: queryKeys.types(spaceId) });
    },
  });
}

export interface UpdateObjectInput {
  id: string;
  rev: number;
  title?: string;
  /** `null` removes the key. */
  properties?: Record<string, unknown | null>;
  /** What the optimistic row shows for each changed cell; `null` clears it. */
  cells?: Record<string, ValueJson | null>;
}

/** Replaces the cells the write carries, keeping every other column as it was. */
function mergeCells(
  values: Record<string, ValueJson>,
  cells: Record<string, ValueJson | null>,
): Record<string, ValueJson> {
  const next = { ...values };
  for (const [key, value] of Object.entries(cells)) {
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}

/** Folds a server object back into the cached rows, so no refetch is needed. */
function applyObject(
  client: QueryClient,
  spaceId: string,
  object: ObjectDetail,
) {
  client.setQueriesData<ObjectList>({ queryKey: queryKeys.objectsPrefix(spaceId) }, (list) => {
    if (!list) {
      return list;
    }
    let changed = false;
    const objects = list.objects.map((row) => {
      if (row.id !== object.id) {
        return row;
      }
      changed = true;
      const values = { ...row.values };
      for (const key of Object.keys(values)) {
        const value = object.properties[key];
        if (value) {
          values[key] = value;
        } else {
          delete values[key];
        }
      }
      return {
        ...row,
        title: object.title,
        rev: object.rev,
        updated_at: object.updated_at,
        values,
      };
    });
    return changed ? { ...list, objects } : list;
  });
}

/**
 * A cell write: the row changes immediately, a refusal restores it.
 *
 * A stale `rev` is a conflict, not a retry: the caller shows the server's
 * sentence and the list refetches to the revision that actually won.
 */
export function useUpdateObject(spaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateObjectInput) =>
      request<ObjectDetail>(`/api/spaces/${spaceId}/objects/${input.id}`, {
        method: "PATCH",
        body: {
          rev: input.rev,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.properties === undefined ? {} : { properties: input.properties }),
        },
      }),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: queryKeys.objectsPrefix(spaceId) });
      const previous = client.getQueriesData<ObjectList>({
        queryKey: queryKeys.objectsPrefix(spaceId),
      });
      client.setQueriesData<ObjectList>(
        { queryKey: queryKeys.objectsPrefix(spaceId) },
        (list) => {
          if (!list) {
            return list;
          }
          const objects = list.objects.map((row) =>
            row.id === input.id
              ? {
                  ...row,
                  ...(input.title === undefined ? {} : { title: input.title }),
                  rev: row.rev + 1,
                  updated_at: new Date().toISOString(),
                  values: input.cells ? mergeCells(row.values, input.cells) : row.values,
                }
              : row,
          );
          return { ...list, objects };
        },
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      for (const [key, data] of context?.previous ?? []) {
        client.setQueryData(key, data);
      }
      if (error instanceof ApiError && error.status === 409) {
        void client.invalidateQueries({ queryKey: queryKeys.objectsPrefix(spaceId) });
      }
    },
    onSuccess: (object) => applyObject(client, spaceId, object),
  });
}

export interface RelationChoice {
  id: string;
  title: string;
  type: string;
}

/**
 * The objects a relation cell may point at.
 *
 * A property with a `target_type` lists that type; an open relation lists every
 * type in the space. The filter is sent empty on purpose: a relation should
 * offer every record, not only those in the type's saved view.
 */
export function useRelationChoices(
  spaceId: string | undefined,
  property: PropertyDef | undefined,
  enabled: boolean,
) {
  const types = useTypes(spaceId);
  const targetKeys = property?.target_type
    ? [property.target_type]
    : (types.data ?? []).map((type) => type.key);
  const lists = useQueries({
    queries: (spaceId ? targetKeys : []).map((key) => ({
      queryKey: queryKeys.relation(spaceId ?? "", key),
      queryFn: async () => {
        const params = new URLSearchParams({
          type: key,
          filter: JSON.stringify({ op: "and", conditions: [] }),
          limit: "500",
        });
        return request<ObjectList>(`/api/spaces/${spaceId}/objects?${params}`);
      },
      enabled: enabled && Boolean(spaceId),
    })),
  });

  const choices: RelationChoice[] = [];
  for (const list of lists) {
    for (const object of list.data?.objects ?? []) {
      choices.push({ id: object.id, title: object.title, type: object.type });
    }
  }
  const loading = types.isPending || lists.some((list) => list.isPending);
  return { choices, loading };
}

