import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";

import { useCreateSpace, useSpaces } from "@/api/queries";
import type { SpaceSummary } from "@/api/types";
import { Button, FormError, TextField } from "@/components/ui/controls";
import { readError, shortId } from "@/lib/display";

/** A keyed entry: the key opens the annotation, the name opens the space. */
function SpaceRow({ space }: { space: SpaceSummary }) {
  const [open, setOpen] = useState(false);
  const noteId = `entry-${space.id}`;

  return (
    <li className="settle border-b rule">
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 py-3.5 md:grid-cols-[5rem_minmax(0,1fr)_4rem_4rem_6rem]">
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
          className="group flex min-w-0 items-baseline gap-2 self-stretch py-1.5 pointer-coarse:min-h-11"
        >
          {space.icon ? (
            <span aria-hidden className="text-[17px] leading-none">
              {space.icon}
            </span>
          ) : null}
          <span className="truncate text-[17px] font-medium tracking-[-0.01em] group-hover:underline">
            {space.name}
          </span>
        </Link>
        <span className="label tnum hidden text-right md:block">{space.member_count}</span>
        <span className="label tnum hidden text-right md:block">{space.type_count}</span>
        <span className="label text-right">{space.role}</span>
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
        </dl>
      ) : null}
    </li>
  );
}

export function SpaceListPage() {
  const spaces = useSpaces();
  const create = useCreateSpace();
  const navigate = useNavigate();

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const icon = String(data.get("icon") ?? "").trim();
    create.mutate(
      { name, ...(icon ? { icon } : {}) },
      {
        onSuccess: (space) => {
          form.reset();
          navigate(`/s/${space.id}`);
        },
      },
    );
  }

  const count = spaces.data?.length ?? 0;

  return (
    <div className="settle">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-[26px] font-medium tracking-[-0.02em]">Spaces</h1>
        <span className="label tnum">
          {count} {count === 1 ? "space" : "spaces"}
        </span>
      </div>

      <div className="mt-6">
        <div
          aria-hidden
          className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] gap-3 border-b rule pb-2 md:grid-cols-[5rem_minmax(0,1fr)_4rem_4rem_6rem]"
        >
          <span className="label">key</span>
          <span className="label">space</span>
          <span className="label hidden text-right md:block">members</span>
          <span className="label hidden text-right md:block">types</span>
          <span className="label text-right">role</span>
        </div>

        {spaces.isPending ? (
          <p className="border-b rule py-6 text-[13px] text-muted">Reading the index…</p>
        ) : spaces.isError ? (
          <div className="grid gap-3 border-b rule py-6">
            <FormError message={readError(spaces.error)} />
            <Button variant="ghost" className="w-fit" onClick={() => void spaces.refetch()}>
              Retry
            </Button>
          </div>
        ) : spaces.data.length === 0 ? (
          <p className="max-w-[52ch] border-b rule py-6 text-muted">
            No spaces yet. Start one for your plants, your chores, or whatever you keep track of.
            The files stay yours.
          </p>
        ) : (
          <ul>
            {spaces.data.map((space) => (
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
          className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_auto] md:items-end"
          onSubmit={onCreate}
        >
          <TextField
            label="Name"
            name="name"
            required
            maxLength={200}
            placeholder="Garden"
          />
          <TextField label="Icon" name="icon" maxLength={8} placeholder="Optional" />
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
