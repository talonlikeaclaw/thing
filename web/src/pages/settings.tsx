import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";

import { type UpdateSpace, useDeleteSpace, useSpace, useUpdateSpace } from "@/api/queries";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { IconPicker } from "@/components/icon-picker";
import { Button, FormError, SelectField, TextField } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { readError } from "@/lib/display";
import { useRouteMeta } from "@/lib/route";
import { timezoneNames } from "@/lib/timezone";

/** `/s/:spaceId/settings` — a space's name, icon, zone and deletion. */
export function SettingsPage() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);
  const update = useUpdateSpace(spaceId ?? "");
  const remove = useDeleteSpace(spaceId ?? "");
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [zone, setZone] = useState("UTC");
  const [confirm, setConfirm] = useState("");

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
  const zoneOptions = timezoneNames(zone).map((value) => ({ value, label: value }));

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

  const onSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dirty || invalid || update.isPending) {
      return;
    }
    update.mutate(changes, {
      onSuccess: (saved) => toast.showToast(`Saved “${saved.name}”.`),
    });
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
        {detail.icon ? (
          <span aria-hidden className="text-[26px] leading-none">
            {detail.icon}
          </span>
        ) : null}
        <h1 className="text-[26px] font-medium tracking-[-0.02em]">Space settings</h1>
        <span className="label">{detail.role}</span>
      </div>

      <section aria-labelledby="space-identity" className="mt-8 border-t rule pt-6">
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
            <SelectField
              label="Timezone"
              value={zone}
              options={zoneOptions}
              onValueChange={setZone}
              disabled={update.isPending}
              hint="Due and overdue are calendar days in this zone."
            />
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
              <span aria-hidden className="text-[26px] leading-none">
                {detail.icon ?? "·"}
              </span>
              <span className="text-[17px]">{detail.name}</span>
            </div>
            <p className="font-mono text-[12px] text-muted">{detail.timezone}</p>
            <p className="text-[13px] text-muted">
              Only an owner can change the name, icon, timezone or delete this space.
            </p>
          </div>
        )}
      </section>

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
              label={`Type “${detail.name}” to confirm`}
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
