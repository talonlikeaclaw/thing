import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";

import {
  type UpdateSpace,
  useDeleteSpace,
  useMe,
  useSpace,
  useUpdateSpace,
} from "@/api/queries";
import { AccentPicker } from "@/components/accent-picker";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { IconPicker } from "@/components/icon-picker";
import { ThingIcon } from "@/components/thing-icon";
import { TimezonePicker } from "@/components/timezone-picker";
import { Button, FormError, TextField } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import {
  DEFAULT_ACCENT,
  accentKey,
  applyAccent,
  readAccent,
  writeAccent,
  type AccentId,
} from "@/lib/accent";
import { readError } from "@/lib/display";
import { useRouteMeta } from "@/lib/route";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { timezoneNames } from "@/lib/timezone";

/** `/s/:spaceId/settings` — a space's name, icon, zone and deletion. */
export function SettingsPage() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);
  const me = useMe();
  const update = useUpdateSpace(spaceId ?? "");
  const remove = useDeleteSpace(spaceId ?? "");
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [zone, setZone] = useState("UTC");
  const [confirm, setConfirm] = useState("");
  const [accent, setAccent] = useState<AccentId>(DEFAULT_ACCENT);
  const userId = me.data?.id;

  useEffect(() => {
    if (!userId || !spaceId) {
      return;
    }
    setAccent(readAccent(window.localStorage, accentKey(userId, spaceId)));
  }, [userId, spaceId]);

  /** Immediate apply and best-effort persist; a refusal never shows an error. */
  const chooseAccent = (next: AccentId) => {
    setAccent(next);
    if (userId && spaceId) {
      writeAccent(window.localStorage, accentKey(userId, spaceId), next);
    }
    applyAccent(document.documentElement, next);
  };

  useEffect(() => {
    if (!space.data) {
      return;
    }
    setName(space.data.name);
    setIcon(space.data.icon ?? "");
    setZone(space.data.timezone);
  }, [space.data]);

  useRouteMeta("Space settings");

  const detail = space.data;
  if (!detail) {
    return <p className="text-[13px] text-muted">Reading the space…</p>;
  }
  const owner = detail.role === "owner";
  const trimmedName = name.trim();
  const nextIcon = icon.trim() ? icon.trim() : null;

  // Only send what changed, so saving one field never rewrites another.
  const changes: UpdateSpace = {};
  if (trimmedName !== detail.name) {
    changes.name = trimmedName;
  }
  if (nextIcon !== detail.icon) {
    changes.icon = nextIcon;
  }
  if (zone !== detail.timezone) {
    changes.timezone = zone;
  }
  const dirty = Object.keys(changes).length > 0;
  const invalid = trimmedName === "";

  function saveDraft(): Promise<boolean> {
    if (!owner || !dirty || invalid || update.isPending) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      update.mutate(changes, {
        onSuccess: (saved) => {
          toast.showToast(`Saved “${saved.name}”.`);
          resolve(true);
        },
        onError: () => resolve(false),
      });
    });
  }

  const guard = useDirtyGuard(dirty, saveDraft);

  const onSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dirty || invalid || update.isPending) {
      return;
    }
    void saveDraft();
  };

  const onDelete = () => {
    if (confirm.trim() !== detail.name || remove.isPending) {
      return;
    }
    remove.mutate(
      { confirm },
      {
        onSuccess: () => {
          toast.showToast(`Deleted “${detail.name}”.`, "danger");
          navigate("/");
        },
      },
    );
  };

  return (
    <div className="settle max-w-[52ch]">
      <Breadcrumbs
        items={[{ label: detail.name, to: `/s/${detail.id}` }, { label: "Space settings" }]}
      />

      <div className="flex items-baseline gap-3">
        <ThingIcon icon={detail.icon} size="lg" />
        <h1 className="text-[26px] font-medium tracking-[-0.02em]">Space settings</h1>
        <span className="label">{detail.role}</span>
      </div>

      <section aria-labelledby="space-identity" className="mt-10">
        <div className="flex items-baseline justify-between border-b rule pb-2">
          <h2 id="space-identity" className="text-[17px] font-medium">
            Identity
          </h2>
          {update.isPending ? <span className="label">saving</span> : null}
        </div>
        {owner ? (
          <form className="mt-4 grid gap-4" onSubmit={onSave}>
            <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start">
              <IconPicker
                label="Icon"
                value={icon}
                onChange={setIcon}
                disabled={update.isPending}
              />
              <TextField
                label="Name"
                name="space-name"
                required
                maxLength={200}
                value={name}
                disabled={update.isPending}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <TimezonePicker
              label="Timezone"
              value={zone}
              zones={timezoneNames(zone)}
              onValueChange={setZone}
              disabled={update.isPending}
            />
            <p className="text-[13px] text-muted">
              Due and overdue are calendar days in this zone.
            </p>
            <FormError message={update.error ? readError(update.error) : null} />
            <div className="flex items-baseline gap-3">
              <Button type="submit" disabled={!dirty || invalid || update.isPending}>
                {update.isPending ? "Saving…" : "Save changes"}
              </Button>
              {dirty ? <span className="label">unsaved changes</span> : null}
            </div>
          </form>
        ) : (
          <div className="mt-4 grid gap-2">
            <div className="flex items-baseline gap-3">
              <ThingIcon icon={detail.icon} size="md" />
              <span className="text-[17px]">{detail.name}</span>
            </div>
            <p className="font-mono text-[12px] text-muted">{detail.timezone}</p>
            <p className="text-[13px] text-muted">
              Only an owner can change the name, icon, timezone or delete this space.
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="space-appearance" className="mt-10">
        <div className="flex items-baseline justify-between border-b rule pb-2">
          <h2 id="space-appearance" className="text-[17px] font-medium">
            Appearance
          </h2>
          {accent !== DEFAULT_ACCENT ? (
            <Button
              variant="ghost"
              className="min-h-8 px-2 py-0 text-[12px]"
              onClick={() => chooseAccent(DEFAULT_ACCENT)}
            >
              Reset to Lichen
            </Button>
          ) : null}
        </div>
        <p className="mt-4 text-[13px] text-muted">
          Highlight is saved in this browser for this space. It changes focus, selection and the
          primary action; nobody else sees it.
        </p>
        <AccentPicker value={accent} onChange={chooseAccent} labelledBy="space-appearance" />
      </section>

      {guard}

      {owner ? (
        <section aria-labelledby="space-danger" className="mt-10">
          <div className="flex items-baseline justify-between border-b border-danger/60 pb-2">
            <h2 id="space-danger" className="text-[17px] font-medium text-danger">
              Delete space
            </h2>
          </div>
          <p className="mt-4 text-[13px] text-muted">
            Deletes <span className="font-mono">{detail.id}</span> and every file inside it. This
            cannot be undone; restore the data directory from a backup to get it back.
          </p>
          <div className="mt-4 grid gap-3">
            <TextField
              label={
                <>
                  Type <span className="normal-case">{detail.name}</span> to confirm
                </>
              }
              name="space-confirm"
              value={confirm}
              autoComplete="off"
              disabled={remove.isPending}
              onChange={(event) => setConfirm(event.target.value)}
            />
            <FormError message={remove.error ? readError(remove.error) : null} />
            <Button
              variant="danger"
              className="w-fit"
              disabled={confirm.trim() !== detail.name || remove.isPending}
              onClick={onDelete}
            >
              {remove.isPending ? "Deleting…" : "Delete this space"}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
