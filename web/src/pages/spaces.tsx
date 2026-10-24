import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

import { useCreateSpace, useMe, useSpaces } from "@/api/queries";
import type { SpaceSummary } from "@/api/types";
import { IconPicker } from "@/components/icon-picker";
import { ThingIcon } from "@/components/thing-icon";
import { ErrorState } from "@/components/error-state";
import { TimezonePicker } from "@/components/timezone-picker";
import { Button, FormError, TextField } from "@/components/ui/controls";
import { readError, shortId } from "@/lib/display";
import { defaultSpaceTimezone, timezoneNames } from "@/lib/timezone";
import { useRouteMeta } from "@/lib/route";
import { readVisits, sortByVisit, visitsKey, type Visits } from "@/lib/visits";

/** A keyed entry: the key opens the annotation, the name opens the space. */
function SpaceRow({ space }: { space: SpaceSummary }) {
  const [open, setOpen] = useState(false);
  const noteId = `entry-${space.id}`;

  return (
    <li className="settle border-b rule">
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 py-3.5 md:grid-cols-[5rem_minmax(0,1fr)]">
        <button
          type="button"
          className="label flex min-h-9 items-center text-left transition-colors hover:text-accent pointer-coarse:min-h-11"
          aria-expanded={open}
          aria-controls={noteId}
          title="Show this entry's annotation"
          onClick={() => setOpen((value) => !value)}
        >
          {shortId(space.id)}
        </button>
        <Link
          to={`/s/${space.id}`}
          className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 self-stretch py-1.5 pointer-coarse:min-h-11 md:grid-cols-[minmax(0,1fr)_4rem_4rem_6rem]"
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <ThingIcon icon={space.icon} size="md" />
            <span className="truncate text-[17px] font-medium tracking-[-0.01em] group-hover:underline">
              {space.name}
            </span>
          </span>
          <span className="label tnum hidden text-right md:block">{space.member_count}</span>
          <span className="label tnum hidden text-right md:block">{space.type_count}</span>
          <span className="label justify-self-end text-right">{space.role}</span>
        </Link>
      </div>
      {open ? (
        <dl
          id={noteId}
          className="mb-3 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1 border-l border-line pl-3 font-mono text-[12px] text-muted"
        >
          <dt className="text-faint">id</dt>
          <dd className="break-all">{space.id}</dd>
          <dt className="text-faint">members</dt>
          <dd className="tnum">{space.member_count}</dd>
          <dt className="text-faint">types</dt>
          <dd className="tnum">{space.type_count}</dd>
          <dt className="text-faint">settings</dt>
          <dd>
            <Link
              to={`/s/${space.id}/settings`}
              className="hover:text-accent"
            >
              edit or delete →
            </Link>
          </dd>
        </dl>
      ) : null}
    </li>
  );
}

export function SpaceListPage() {
  useRouteMeta("Spaces");
  const spaces = useSpaces();
  const me = useMe();
  const create = useCreateSpace();
  const navigate = useNavigate();
  const [timezone, setTimezone] = useState(defaultSpaceTimezone);
  const [icon, setIcon] = useState("");
  const [visits, setVisits] = useState<Visits>({});
  const userId = me.data?.id;

  // Recency is browser-local; reading it here keeps the list honest across
  // reloads without a server field.
  useEffect(() => {
    if (!userId) {
      setVisits({});
      return;
    }
    setVisits(readVisits(window.localStorage, visitsKey(userId)));
  }, [userId]);

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    create.mutate(
      { name, timezone, ...(icon.trim() ? { icon: icon.trim() } : {}) },
      {
        onSuccess: (space) => {
          form.reset();
          setIcon("");
          navigate(`/s/${space.id}`);
        },
      },
    );
  }

  const sorted = spaces.data ? sortByVisit(spaces.data, visits) : [];
  const count = spaces.data?.length;

  return (
    <div className="settle">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-[26px] font-medium tracking-[-0.02em]">Spaces</h1>
        {count !== undefined ? (
          <span className="label tnum">
            {count} {count === 1 ? "space" : "spaces"}
          </span>
        ) : null}
      </div>

      <div className="mt-6">
        <div
          aria-hidden
          className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 border-b rule pb-2 md:grid-cols-[5rem_minmax(0,1fr)]"
        >
          <span className="label">key</span>
          <span className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 md:grid-cols-[minmax(0,1fr)_4rem_4rem_6rem]">
            <span className="label">space</span>
            <span className="label hidden text-right md:block">members</span>
            <span className="label hidden text-right md:block">types</span>
            <span className="label text-right">role</span>
          </span>
        </div>

        {spaces.isPending ? (
          <p className="border-b rule py-6 text-[13px] text-muted">Reading the index…</p>
        ) : spaces.isError ? (
          <div className="border-b rule py-6">
            <ErrorState
              error={spaces.error}
              subject="The index"
              onRetry={() => void spaces.refetch()}
            />
          </div>
        ) : sorted.length === 0 ? (
          <p className="max-w-[52ch] border-b rule py-6 text-muted">
            No spaces yet. Start one below; you can invite people once it exists.
          </p>
        ) : (
          <ul>
            {sorted.map((space) => (
              <SpaceRow key={space.id} space={space} />
            ))}
          </ul>
        )}
      </div>

      <section aria-labelledby="new-space" className="mt-12">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 id="new-space" className="text-[17px] font-medium tracking-[-0.01em]">
            Start a space
          </h2>
          <p className="text-[13px] text-muted">Name it for what you track.</p>
        </div>
        <form
          className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_9rem_14rem_auto] md:items-end"
          onSubmit={onCreate}
        >
          <TextField
            label="Name"
            name="name"
            required
            maxLength={200}
            placeholder="Garden"
          />
          <IconPicker label="Icon" value={icon} onChange={setIcon} />
          <TimezonePicker
            label="Timezone"
            value={timezone}
            zones={timezoneNames(timezone)}
            onValueChange={setTimezone}
            showDeviceZone={false}
          />
          <p className="text-[13px] text-muted md:col-start-3 md:row-start-2 md:-mt-1">
            Due and overdue are calendar days in this zone.
          </p>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create space"}
          </Button>
        </form>
        <div className="mt-3">
          <FormError message={create.error ? readError(create.error) : null} />
        </div>
      </section>
    </div>
  );
}
