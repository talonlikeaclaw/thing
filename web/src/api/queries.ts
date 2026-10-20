import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { isUnauthenticated, request } from "@/api/client";
import type { SpaceDetail, SpaceSummary, Session, User } from "@/api/types";

export const queryKeys = {
  me: ["me"] as const,
  spaces: ["spaces"] as const,
  space: (id: string) => ["space", id] as const,
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
