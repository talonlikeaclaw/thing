import { useMutation, useQuery, useQueryClient, useQueries } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { ApiError, downloadFile, isUnauthenticated, request, sendCsv } from "@/api/client";
import type {
  Agenda,
  CreateView,
  CsvImportResult,
  CsvPreview,
  DuplicateObjectInput,
  ObjectDetail,
  ObjectList,
  ObjectsQuery,
  PropertyDef,
  PropertyFormat,
  Revision,
  SpaceDetail,
  SpaceSummary,
  Session,
  TrashItem,
  TypeDef,
  TypeProperty,
  TypeSummary,
  UpdateView,
  User,
  Uuid,
  ValueJson,
} from "@/api/types";
import { readError } from "@/lib/display";

export const queryKeys = {
  me: ["me"] as const,
  spaces: ["spaces"] as const,
  space: (id: string) => ["space", id] as const,
  types: (id: string) => ["space", id, "types"] as const,
  type: (id: string, key: string) => ["space", id, "type", key] as const,
  properties: (id: string) => ["space", id, "properties"] as const,
  objects: (id: string, query: ObjectsQuery) => ["space", id, "objects", query] as const,
  objectsPrefix: (id: string) => ["space", id, "objects"] as const,
  agenda: (id: string, days = 14) => ["space", id, "agenda", days] as const,
  object: (id: string, objectId: string) => ["space", id, "object", objectId] as const,
  history: (id: string, objectId: string) =>
    ["space", id, "object", objectId, "history"] as const,
  trash: (id: string) => ["space", id, "trash"] as const,
  relation: (id: string, type: string) => ["space", id, "relation", type] as const,
  palette: (id: string, typeKey: string) => ["space", id, "palette", typeKey] as const,
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
  timezone?: string;
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

export interface UpdateSpace {
  name?: string;
  icon?: string | null;
  timezone?: string;
}

/** Space settings: name, icon and the zone that makes a due day a calendar day. */
export function useUpdateSpace(spaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSpace) =>
      request<SpaceDetail>(`/api/spaces/${spaceId}`, { method: "PATCH", body: input }),
    onSuccess: (space) => {
      client.setQueryData(queryKeys.space(spaceId), space);
      void client.invalidateQueries({ queryKey: queryKeys.spaces });
      void client.invalidateQueries({ queryKey: queryKeys.space(spaceId) });
    },
  });
}

/** Deletes the space and its files; `confirm` must repeat the space's name. */
export function useDeleteSpace(spaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { confirm: string }) =>
      request<void>(`/api/spaces/${spaceId}`, { method: "DELETE", body: input }),
    onSuccess: () => {
      client.removeQueries({ queryKey: queryKeys.space(spaceId) });
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
  schedule?: boolean;
}

export interface UpdateType {
  name?: string;
  name_plural?: string;
  /** `null` clears the icon; omitting the field leaves it alone. */
  icon?: string | null;
  description?: string;
  schedule?: boolean;
  properties?: TypeProperty[];
}

/** Every write can change counts and definitions, so refresh the whole space. */
function useSpaceMutation<TInput, TResult>(
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
  return useSpaceMutation<NewType, TypeDef>(spaceId, (input) =>
    request<TypeDef>(`/api/spaces/${spaceId}/types`, { method: "POST", body: input }),
  );
}

export function useUpdateType(spaceId: string, key: string) {
  return useSpaceMutation<UpdateType, TypeDef>(spaceId, (input) =>
    request<TypeDef>(`/api/spaces/${spaceId}/types/${key}`, {
      method: "PATCH",
      body: input,
    }),
  );
}

/** Every view write returns the whole type; seed it so tabs and keys never lag. */
function useViewMutation<TInput>(
  spaceId: string,
  typeKey: string,
  mutationFn: (input: TInput) => Promise<TypeDef>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (detail) => {
      client.setQueryData(queryKeys.type(spaceId, typeKey), detail);
      void client.invalidateQueries({ queryKey: queryKeys.space(spaceId) });
    },
  });
}

/** Creates a view; the returned type detail carries the minted key. */
export function useCreateView(spaceId: string, typeKey: string) {
  return useViewMutation<CreateView>(spaceId, typeKey, (input) =>
    request<TypeDef>(`/api/spaces/${spaceId}/types/${typeKey}/views`, {
      method: "POST",
      body: input,
    }),
  );
}

/** Renames or reconfigures one view; the key and kind stay fixed. */
export function useUpdateView(spaceId: string, typeKey: string, viewKey: string) {
  return useViewMutation<UpdateView>(spaceId, typeKey, (input) =>
    request<TypeDef>(`/api/spaces/${spaceId}/types/${typeKey}/views/${viewKey}`, {
      method: "PATCH",
      body: input,
    }),
  );
}

/** Deletes a view; the server refuses the last one and promotes a default. */
export function useDeleteView(spaceId: string, typeKey: string) {
  return useViewMutation<string>(spaceId, typeKey, (viewKey) =>
    request<TypeDef>(`/api/spaces/${spaceId}/types/${typeKey}/views/${viewKey}`, {
      method: "DELETE",
    }),
  );
}

/** Makes one view the default; the server keeps it idempotent. */
export function useSetDefaultView(spaceId: string, typeKey: string) {
  return useViewMutation<string>(spaceId, typeKey, (viewKey) =>
    request<TypeDef>(`/api/spaces/${spaceId}/types/${typeKey}/views/${viewKey}/default`, {
      method: "POST",
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
  return useSpaceMutation<NewProperty, PropertyDef>(spaceId, (input) =>
    request<PropertyDef>(`/api/spaces/${spaceId}/properties`, {
      method: "POST",
      body: input,
    }),
  );
}

export function useUpdateProperty(spaceId: string, key: string) {
  return useSpaceMutation<UpdateProperty, PropertyDef>(spaceId, (input) =>
    request<PropertyDef>(`/api/spaces/${spaceId}/properties/${key}`, {
      method: "PATCH",
      body: input,
    }),
  );
}

/** The list endpoint always takes its query in the URL; an empty filter is unfiltered. */
function objectsPath(spaceId: string, query: ObjectsQuery): string {
  const params = new URLSearchParams({ type: query.type });
  if (query.view) {
    params.set("view", query.view);
  }
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

export function useObject(spaceId: string | undefined, objectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.object(spaceId ?? "", objectId ?? ""),
    queryFn: () => request<ObjectDetail>(`/api/spaces/${spaceId}/objects/${objectId}`),
    enabled: Boolean(spaceId && objectId),
  });
}

/** The space's due buckets, computed by the server in the space's timezone. */
export function useAgenda(spaceId: string | undefined, days = 14) {
  return useQuery({
    queryKey: queryKeys.agenda(spaceId ?? "", days),
    queryFn: () => request<Agenda>(`/api/spaces/${spaceId}/agenda?days=${days}`),
    enabled: Boolean(spaceId),
  });
}

export function useHistory(spaceId: string | undefined, objectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.history(spaceId ?? "", objectId ?? ""),
    queryFn: () => request<Revision[]>(`/api/spaces/${spaceId}/objects/${objectId}/history`),
    enabled: Boolean(spaceId && objectId),
  });
}

export function useTrash(spaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.trash(spaceId ?? ""),
    queryFn: () => request<TrashItem[]>(`/api/spaces/${spaceId}/trash`),
    enabled: Boolean(spaceId),
  });
}

/** Trashing, restoring and purging all change the space's lists and counts. */
export function useTrashObject(spaceId: string) {
  return useSpaceMutation<string, TrashItem>(spaceId, (id) =>
    request<TrashItem>(`/api/spaces/${spaceId}/objects/${id}`, { method: "DELETE" }),
  );
}

export function useRestoreObject(spaceId: string) {
  return useSpaceMutation<string, ObjectDetail>(spaceId, (id) =>
    request<ObjectDetail>(`/api/spaces/${spaceId}/objects/${id}/restore`, { method: "POST" }),
  );
}

export function usePurgeObject(spaceId: string) {
  return useSpaceMutation<string, void>(spaceId, (id) =>
    request<void>(`/api/spaces/${spaceId}/trash/${id}`, { method: "DELETE" }),
  );
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
  /** The markdown body, when this write carries one. */
  body?: string;
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
  client.setQueryData(queryKeys.object(spaceId, object.id), object);
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
        ...(object.schedule === undefined ? {} : { schedule: object.schedule }),
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
          ...(input.body === undefined ? {} : { body: input.body }),
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
        void client.invalidateQueries({ queryKey: queryKeys.object(spaceId, _input.id) });
      }
    },
    onSuccess: (object) => applyObject(client, spaceId, object),
  });
}

export interface CompleteObjectInput {
  id: string;
  rev: number;
  /** The full row when the caller already holds it, so Undo needs no extra read. */
  previous?: ObjectDetail;
}

/** The two values Complete may change, kept so the toast can restore them. */
export interface PreviousSchedule {
  due_date: unknown | null;
  last_completed_at: unknown | null;
}

export interface CompleteResult {
  object: ObjectDetail;
  previous: PreviousSchedule;
}

function previousSchedule(object: ObjectDetail): PreviousSchedule {
  return {
    due_date: object.properties.due_date?.value ?? null,
    last_completed_at: object.properties.last_completed_at?.value ?? null,
  };
}

/**
 * Records one completion. The server advances a recurring due date and writes
 * the revision; the space prefix is invalidated so every surface re-reads it.
 *
 * The returned `undo` writes the two prior schedule values back at the new
 * revision, which is why the mutation captures them before completing.
 */
export function useCompleteObject(spaceId: string) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: CompleteObjectInput): Promise<CompleteResult> => {
      const before =
        input.previous ??
        (await request<ObjectDetail>(`/api/spaces/${spaceId}/objects/${input.id}`));
      if (before.rev !== input.rev) {
        throw new ApiError(
          409,
          "conflict",
          "This record changed since it was loaded. Reload it to see the current version.",
          { current_rev: before.rev },
        );
      }
      const object = await request<ObjectDetail>(
        `/api/spaces/${spaceId}/objects/${input.id}/complete`,
        { method: "POST", body: { rev: input.rev } },
      );
      return { object, previous: previousSchedule(before) };
    },
    onSuccess: (result) => {
      applyObject(client, spaceId, result.object);
      void client.invalidateQueries({ queryKey: queryKeys.space(spaceId) });
    },
    onError: (error, input) => {
      if (error instanceof ApiError && error.status === 409) {
        void client.invalidateQueries({ queryKey: queryKeys.objectsPrefix(spaceId) });
        void client.invalidateQueries({ queryKey: queryKeys.object(spaceId, input.id) });
      }
    },
  });

  const undo = useCallback(
    async (completed: ObjectDetail, previous: PreviousSchedule) => {
      const object = await request<ObjectDetail>(
        `/api/spaces/${spaceId}/objects/${completed.id}`,
        {
          method: "PATCH",
          body: {
            rev: completed.rev,
            properties: {
              due_date: previous.due_date,
              last_completed_at: previous.last_completed_at,
            },
          },
        },
      );
      applyObject(client, spaceId, object);
      void client.invalidateQueries({ queryKey: queryKeys.space(spaceId) });
      return object;
    },
    [client, spaceId],
  );

  return { ...mutation, undo };
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


/** A title the palette can match, bounded to the newest rows of each type. */
export interface PaletteRecord {
  id: Uuid;
  type: string;
  title: string;
  updated_at: string;
}

/**
 * The palette looks at titles, not the saved view: an empty filter keeps every
 * record eligible and the updated-desc sort makes the cap the newest rows.
 */
export function usePaletteRecords(
  spaceId: string | undefined,
  typeKeys: string[],
  enabled: boolean,
): PaletteRecord[] {
  const lists = useQueries({
    queries: (spaceId ? typeKeys : []).map((key) => ({
      queryKey: queryKeys.palette(spaceId ?? "", key),
      queryFn: async () => {
        const params = new URLSearchParams({
          type: key,
          filter: JSON.stringify({ op: "and", conditions: [] }),
          sorts: JSON.stringify([{ property: "updated_at", direction: "desc" }]),
          limit: "100",
        });
        return request<ObjectList>(`/api/spaces/${spaceId}/objects?${params}`);
      },
      enabled: enabled && Boolean(spaceId),
      staleTime: 60_000,
    })),
  });

  const rows: PaletteRecord[] = [];
  for (const list of lists) {
    for (const object of list.data?.objects ?? []) {
      rows.push({
        id: object.id,
        type: object.type,
        title: object.title,
        updated_at: object.updated_at,
      });
    }
  }
  return rows;
}

/** A duplicate is an ordinary create, so the returned detail is a new object. */
export function useDuplicateObject(spaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: DuplicateObjectInput) =>
      request<ObjectDetail>(`/api/spaces/${spaceId}/objects/${input.id}/duplicate`, {
        method: "POST",
        body: input.title === undefined ? {} : { title: input.title },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.objectsPrefix(spaceId) });
      void client.invalidateQueries({ queryKey: queryKeys.space(spaceId) });
      void client.invalidateQueries({ queryKey: queryKeys.types(spaceId) });
    },
  });
}

export interface BulkTarget {
  id: Uuid;
  rev: number;
}

export interface BulkFailure {
  id: Uuid;
  message: string;
}

/** The per-record outcome of a fan-out; there is no batch route. */
export interface BulkResult {
  succeeded: Uuid[];
  failed: BulkFailure[];
}

async function fanOut<T>(
  items: readonly T[],
  idOf: (item: T) => Uuid,
  run: (item: T) => Promise<Uuid>,
): Promise<BulkResult> {
  const results = await Promise.allSettled(items.map(run));
  const succeeded: Uuid[] = [];
  const failed: BulkFailure[] = [];
  results.forEach((result, index) => {
    const item = items[index];
    if (item === undefined) {
      return;
    }
    if (result.status === "fulfilled") {
      succeeded.push(result.value);
    } else {
      failed.push({ id: idOf(item), message: readError(result.reason) });
    }
  });
  return { succeeded, failed };
}

/** Bulk writes are truthful counts, not optimistic row rewrites. */
function useBulkMutation<TInput>(
  spaceId: string,
  mutationFn: (input: TInput) => Promise<BulkResult>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.objectsPrefix(spaceId) });
      void client.invalidateQueries({ queryKey: queryKeys.space(spaceId) });
    },
  });
}

export function useBulkUpdateObjects(spaceId: string) {
  return useBulkMutation<{
    targets: BulkTarget[];
    properties: Record<string, unknown | null>;
  }>(spaceId, ({ targets, properties }) =>
    fanOut(
      targets,
      (target) => target.id,
      async (target) => {
        await request<ObjectDetail>(`/api/spaces/${spaceId}/objects/${target.id}`, {
          method: "PATCH",
          body: { rev: target.rev, properties },
        });
        return target.id;
      },
    ),
  );
}

export function useBulkTrashObjects(spaceId: string) {
  return useBulkMutation<Uuid[]>(spaceId, (ids) =>
    fanOut(
      ids,
      (id) => id,
      async (id) => {
        await request<TrashItem>(`/api/spaces/${spaceId}/objects/${id}`, { method: "DELETE" });
        return id;
      },
    ),
  );
}

export function useBulkRestoreObjects(spaceId: string) {
  return useBulkMutation<Uuid[]>(spaceId, (ids) =>
    fanOut(
      ids,
      (id) => id,
      async (id) => {
        await request<ObjectDetail>(`/api/spaces/${spaceId}/objects/${id}/restore`, {
          method: "POST",
        });
        return id;
      },
    ),
  );
}

/** Succeeds with the created ids, so Undo can trash exactly what this made. */
export function useBulkDuplicateObjects(spaceId: string) {
  return useBulkMutation<DuplicateObjectInput[]>(spaceId, (inputs) =>
    fanOut(
      inputs,
      (input) => input.id,
      async (input) => {
        const created = await request<ObjectDetail>(
          `/api/spaces/${spaceId}/objects/${input.id}/duplicate`,
          {
            method: "POST",
            body: input.title === undefined ? {} : { title: input.title },
          },
        );
        return created.id;
      },
    ),
  );
}

/** A dry run parses and validates the file; it never writes. */
export function useCsvPreview(spaceId: string, typeKey: string) {
  return useMutation({
    mutationFn: (file: File) =>
      sendCsv<CsvPreview>(
        `/api/spaces/${spaceId}/types/${typeKey}/import?dry_run=true`,
        file,
      ),
  });
}

/** A commit refuses every problem; a partial I/O failure still refreshes the space. */
export function useImportCsv(spaceId: string, typeKey: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      sendCsv<CsvImportResult>(
        `/api/spaces/${spaceId}/types/${typeKey}/import?dry_run=false`,
        file,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.space(spaceId) }),
    onError: (error) => {
      if (error instanceof ApiError && error.status >= 500) {
        void client.invalidateQueries({ queryKey: queryKeys.space(spaceId) });
      }
    },
  });
}

/** Export is a download, so its button owns pending state, not a query cache. */
export function useExportCsv(spaceId: string, typeKey: string) {
  return useMutation<void, Error, boolean | undefined>({
    mutationFn: (template = false) =>
      downloadFile(
        `/api/spaces/${spaceId}/types/${typeKey}/export${template ? "?template=true" : ""}`,
        `thing-${typeKey}.csv`,
      ),
  });
}
