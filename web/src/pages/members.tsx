import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import {
  useCreateInvite,
  useInvites,
  useMe,
  useRemoveMember,
  useRevokeInvite,
  useSetMember,
  useSpace,
} from "@/api/queries";
import type { Invite, Member, Role, SpaceDetail } from "@/api/types";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ErrorState } from "@/components/error-state";
import { Button, FormError, SelectField } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { formatDate, readError } from "@/lib/display";
import { useRouteMeta } from "@/lib/route";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
];

/** `/s/:spaceId/members` — people, their roles and the owner's invites. */
export function MembersPage() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);
  const me = useMe();

  useRouteMeta("Members");

  const detail = space.data;
  if (!detail) {
    if (space.isError) {
      return (
        <ErrorState
          error={space.error}
          subject="Members"
          onRetry={() => void space.refetch()}
        />
      );
    }
    return <p className="text-[13px] text-muted">Reading the space…</p>;
  }

  const owner = detail.role === "owner";

  return (
    <div className="settle max-w-[64ch]">
      <Breadcrumbs
        items={[{ label: detail.name, to: `/s/${detail.id}` }, { label: "Members" }]}
      />

      <div className="flex items-baseline gap-3">
        {detail.icon ? (
          <span aria-hidden className="text-[26px] leading-none">
            {detail.icon}
          </span>
        ) : null}
        <h1 className="text-[26px] font-medium tracking-[-0.02em]">{detail.name}</h1>
        <span className="label">{detail.role}</span>
      </div>

      <p className="mt-2 max-w-[62ch] text-[13px] text-muted">
        Owner manages the space and people; editor creates and edits content; viewer reads only.
      </p>

      <dl className="mt-8 grid gap-x-6 gap-y-3 border-t rule pt-6 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <dt className="label">Space id</dt>
        <dd className="font-mono text-[12px] break-all text-muted">{detail.id}</dd>
        <dt className="label">Created</dt>
        <dd className="font-mono text-[12px] text-muted">{formatDate(detail.created_at)}</dd>
        <dt className="label">Types</dt>
        <dd className="font-mono text-[12px] tnum text-muted">{detail.type_count}</dd>
      </dl>

      <MemberList
        spaceId={detail.id}
        detail={detail}
        owner={owner}
        currentUser={me.data?.id}
      />

      {owner ? <InvitePanel spaceId={detail.id} /> : null}

      {!owner ? (
        <p className="mt-8 border-t rule pt-4 text-[13px] text-muted">
          Only an owner can invite or change roles.
        </p>
      ) : null}
    </div>
  );
}

function MemberList({
  spaceId,
  detail,
  owner,
  currentUser,
}: {
  spaceId: string;
  detail: SpaceDetail;
  owner: boolean;
  currentUser: string | undefined;
}) {
  const setMember = useSetMember(spaceId);
  const removeMember = useRemoveMember(spaceId);
  const navigate = useNavigate();
  const toast = useToast();
  const [roleError, setRoleError] = useState<{ user: string; message: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<{ user: string; message: string } | null>(
    null,
  );

  function changeRole(member: Member, role: Role) {
    if (role === member.role || !owner) {
      return;
    }
    setRoleError(null);
    setMember.mutate(
      { user: member.user, role },
      {
        onSuccess: () => toast.showToast(`${member.name} is now ${role}.`),
        onError: (error) =>
          setRoleError({ user: member.user, message: readError(error) }),
      },
    );
  }

  function confirmRemoval(member: Member) {
    setRemoveError(null);
    removeMember.mutate(member.user, {
      onSuccess: () => {
        setRemoving(null);
        toast.showToast(`Removed ${member.name}.`);
        if (member.user === currentUser) {
          navigate("/");
        }
      },
      onError: (error) =>
        setRemoveError({ user: member.user, message: readError(error) }),
    });
  }

  return (
    <section aria-labelledby="members" className="mt-10">
      <div className="flex items-baseline justify-between border-b rule pb-2">
        <h2 id="members" className="text-[17px] font-medium">
          Members
        </h2>
        <span className="label tnum">{detail.members.length}</span>
      </div>
      <ul>
        {detail.members.map((member) => {
          const self = member.user === currentUser;
          const saving = setMember.isPending && setMember.variables?.user === member.user;
          const removingThis = removing === member.user;
          return (
            <li key={member.user} className="grid gap-2 border-b rule py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                <span className="min-w-0">
                  <span className="block truncate text-[15px]">
                    {member.name}
                    {self ? <span className="label ml-2">you</span> : null}
                  </span>
                  <span className="block font-mono text-[11px] break-all text-muted">
                    {member.email ?? member.user}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {saving ? <span className="label">saving</span> : null}
                  {owner ? (
                    <select
                      aria-label={`Role for ${member.name}`}
                      className="h-8 rounded-field border border-line-interactive bg-ground px-2 text-[13px] text-ink transition-colors hover:border-line-strong focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]"
                      value={member.role}
                      disabled={saving || removeMember.isPending}
                      onChange={(event) => changeRole(member, event.target.value as Role)}
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="label w-14 text-right">{member.role}</span>
                  )}
                  {owner && !removingThis ? (
                    <Button
                      variant="ghost"
                      className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                      onClick={() => {
                        setRemoving(member.user);
                        setRemoveError(null);
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </span>
              </div>

              {roleError?.user === member.user ? (
                <FormError message={roleError.message} />
              ) : null}

              {owner && removingThis ? (
                <div
                  role="group"
                  aria-label={`Remove ${member.name}`}
                  className="flex flex-wrap items-center gap-3 border-l border-danger pl-3"
                >
                  <p className="text-[13px] text-muted">
                    {self
                      ? "Remove yourself? You will lose access to this space and its files."
                      : `Remove ${member.name}? They will lose access to this space.`}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="danger"
                      className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                      disabled={removeMember.isPending}
                      onClick={() => confirmRemoval(member)}
                    >
                      {removeMember.isPending ? "Removing…" : "Remove member"}
                    </Button>
                    <Button
                      variant="ghost"
                      className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                      disabled={removeMember.isPending}
                      onClick={() => setRemoving(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}

              {removeError?.user === member.user ? (
                <FormError message={removeError.message} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function inviteUrl(code: string): string {
  return `${window.location.origin}/join/${code}`;
}

function InvitePanel({ spaceId }: { spaceId: string }) {
  const invites = useInvites(spaceId, true);
  const create = useCreateInvite(spaceId);
  const revoke = useRevokeInvite(spaceId);
  const toast = useToast();
  const [role, setRole] = useState<Role>("editor");
  const [revokeError, setRevokeError] = useState<{ code: string; message: string } | null>(
    null,
  );

  const pending = (invites.data ?? []).filter((invite) => invite.used_at === null);
  const used = (invites.data ?? []).filter((invite) => invite.used_at !== null);

  return (
    <section aria-labelledby="invites" className="mt-10">
      <div className="flex items-baseline justify-between border-b rule pb-2">
        <h2 id="invites" className="text-[17px] font-medium">
          Invite people
        </h2>
        <span className="label tnum">{pending.length} pending</span>
      </div>

      <form
        className="mt-4 grid gap-3 sm:grid-cols-[12rem_auto_minmax(0,1fr)] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(role, {
            onSuccess: () => toast.showToast("Invite created."),
          });
        }}
      >
        <SelectField
          label="Role"
          value={role}
          options={ROLE_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          onValueChange={(value) => setRole(value as Role)}
          disabled={create.isPending}
        />
        <Button
          type="submit"
          className="min-h-10 px-4 text-[13px]"
          disabled={create.isPending}
        >
          {create.isPending ? "Creating…" : "Create invite"}
        </Button>
        <div>
          <FormError message={create.error ? readError(create.error) : null} />
        </div>
      </form>

      {invites.isPending ? (
        <p className="mt-4 border-t rule pt-3 text-[13px] text-muted">Reading invites…</p>
      ) : invites.isError ? (
        <div className="mt-4 border-t rule pt-3">
          <ErrorState
            error={invites.error}
            subject="Invites"
            onRetry={() => void invites.refetch()}
          />
        </div>
      ) : (
        <>
          <InviteList
            title="Pending"
            invites={pending}
            empty="No unused invites. Create one above and copy its link."
            onRevoke={(code) => {
              setRevokeError(null);
              revoke.mutate(code, {
                onSuccess: () => toast.showToast("Invite revoked."),
                onError: (error) =>
                  setRevokeError({ code, message: readError(error) }),
              });
            }}
            revoking={revoke.isPending ? revoke.variables : undefined}
            revokeError={revokeError}
          />
          {used.length > 0 ? (
            <InviteList
              title="Used"
              invites={used}
              empty=""
              onRevoke={undefined}
              revoking={undefined}
              revokeError={null}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function InviteList({
  title,
  invites,
  empty,
  onRevoke,
  revoking,
  revokeError,
}: {
  title: string;
  invites: Invite[];
  empty: string;
  onRevoke: ((code: string) => void) | undefined;
  revoking: string | undefined;
  revokeError: { code: string; message: string } | null;
}) {
  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between border-b rule pb-1.5">
        <h3 className="text-[15px] font-medium">{title}</h3>
        <span className="label tnum">{invites.length}</span>
      </div>
      {invites.length === 0 ? (
        empty ? <p className="py-3 text-[13px] text-muted">{empty}</p> : null
      ) : (
        <ul>
          {invites.map((invite) => (
            <InviteRow
              key={invite.code}
              invite={invite}
              onRevoke={onRevoke}
              revoking={revoking === invite.code}
              error={revokeError?.code === invite.code ? revokeError.message : null}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function InviteRow({
  invite,
  onRevoke,
  revoking,
  error,
}: {
  invite: Invite;
  onRevoke: ((code: string) => void) | undefined;
  revoking: boolean;
  error: string | null;
}) {
  const toast = useToast();
  const url = inviteUrl(invite.code);
  const input = useRef<HTMLInputElement | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.showToast("Invite link copied");
    } catch {
      // A blocked clipboard still leaves the link selectable by hand.
      input.current?.focus();
      input.current?.select();
    }
  }

  return (
    <li className="grid gap-2 border-b rule py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-baseline gap-2">
          <span className="label">{invite.role}</span>
          <span className="font-mono text-[10.5px] text-faint">
            {invite.used_at
              ? `used ${formatDate(invite.used_at)}`
              : `created ${formatDate(invite.created_at)}`}
          </span>
        </span>
        {onRevoke ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
              onClick={() => void copy()}
            >
              Copy link
            </Button>
            <Button
              variant="ghost"
              className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
              disabled={revoking}
              onClick={() => onRevoke(invite.code)}
            >
              {revoking ? "Revoking…" : "Revoke"}
            </Button>
          </div>
        ) : null}
      </div>
      <input
        ref={input}
        readOnly
        aria-label={`Invite link for ${invite.code}`}
        value={url}
        onFocus={(event) => event.currentTarget.select()}
        className="w-full rounded-field border border-line bg-ground px-3 py-2 font-mono text-[11px] text-muted"
      />
      {error ? <FormError message={error} /> : null}
    </li>
  );
}
