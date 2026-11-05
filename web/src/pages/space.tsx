import { ArrowRight, Plus } from "lucide-react";
import { Link, useParams } from "react-router";

import { useSpace, useSpaceActivity, useSpaceGraph, useTypes } from "@/api/queries";
import type { ActivityEntry, TypeSummary } from "@/api/types";
import { ThumbRow } from "@/components/handedness";
import { useQuickCapture } from "@/components/quick-capture";
import { SpaceGraph } from "@/components/space-graph";
import { ThingIcon } from "@/components/thing-icon";
import { Button } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { shortId } from "@/lib/display";
import { relativeTime, typeLabel } from "@/lib/format";
import { useRouteMeta } from "@/lib/route";
import { keyFromName } from "@/lib/schema";

/** The margin is a glance at the space, not its audit log. */
const MARGIN_ACTIVITY = 5;
/** Fields named in one margin line before the rest become a count. */
const NAMED_CHANGES = 3;

/**
 * `/s/:spaceId` — the space cover sheet: a masthead that names the space and
 * states its size, the type ledger that is the page, the recent timeline in the
 * margin where there is one, and a colophon naming the files behind it.
 */
export function SpacePage() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const activity = useSpaceActivity(spaceId);
  const graph = useSpaceGraph(spaceId, true);
  const capture = useQuickCapture();

  useRouteMeta(space.data?.name ?? "Space");

  const detail = space.data;
  if (!detail) {
    return <p className="text-[13px] text-muted">Reading the space…</p>;
  }
  const canEdit = detail.role !== "viewer";
  const typeList = types.data ?? [];
  const written = activity.data?.entries ?? [];
  const shown = written.slice(0, MARGIN_ACTIVITY);
  const typeNames = new Map(typeList.map((type) => [type.key, type.name]));
  const recordCount = typeList.reduce((total, type) => total + type.object_count, 0);
  const summary = [
    `${typeList.length} ${typeList.length === 1 ? "type" : "types"}`,
    `${recordCount} ${recordCount === 1 ? "record" : "records"}`,
    `${detail.members.length} ${detail.members.length === 1 ? "member" : "members"}`,
    detail.role,
  ].join(" · ");

  return (
    <div className="settle">
      <header className="px-1 pb-7">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
          <div className="flex min-w-0 items-center gap-4">
            <span className="glass grid size-14 shrink-0 place-items-center rounded-[18px] text-[30px]">
              <ThingIcon icon={detail.icon} name={detail.name} />
            </span>
            <div className="min-w-0">
              <h1 className="display text-display break-words">{detail.name}</h1>
              <p className="tnum mt-2 font-mono text-[length:var(--text-label)] leading-[var(--text-label--line-height)] tracking-[0.06em] text-muted">
                {summary}
              </p>
            </div>
          </div>
          <ThumbRow className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" render={<Link to={`/s/${detail.id}/agenda`} />}>
              Open schedule
            </Button>
            {canEdit ? <Button onClick={() => capture.open()}>Capture a record</Button> : null}
          </ThumbRow>
        </div>
      </header>

      {/* One grid from the cover's first rule down: the ledger and the graph
          share the 8-column body, the activity timeline holds the 4-column
          margin beside both. `items-start` keeps each column as tall as its
          own rows instead of stretching to its neighbour. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:items-start xl:gap-6">
        <section
          aria-labelledby="space-types"
          // Without a margin the body keeps the full sheet, rather than
          // leaving a third of the page empty beside it.
          className={cn(
            "xl:col-span-8 xl:col-start-1 xl:row-start-1",
            activity.isSuccess && written.length === 0 && "xl:col-span-12",
          )}
        >
          <div className="h-full rounded-[22px] border border-line bg-surface p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-3 pb-3">
            <h2 id="space-types" className="label text-faint">
              Types
            </h2>
            <span className="label tnum text-faint">{typeList.length}</span>
          </div>

          {typeList.length === 0 ? (
            <Onboarding spaceId={detail.id} canEdit={canEdit} />
          ) : (
            <ul className="border-t rule">
              {typeList.map((type) => (
                <TypeRow key={type.key} spaceId={detail.id} type={type} />
              ))}
              {canEdit ? (
                <li className="border-b rule">
                  <Link
                    to={`/s/${detail.id}/schema`}
                    className="flex min-h-11 items-center gap-2 py-3 pl-1 text-[13px] text-muted transition-colors hover:text-accent"
                  >
                    <Plus aria-hidden size={14} className="shrink-0" />
                    New type
                  </Link>
                </li>
              ) : null}
            </ul>
          )}
          </div>
        </section>

        {/* The margin reports what the space itself recorded. A space nothing
            has been written to yet shows no column rather than an empty
            heading, so the ledger keeps the full width. */}
        {activity.isSuccess && written.length === 0 ? null : (
          <aside
            aria-labelledby="space-activity"
            className="glass rounded-[22px] p-5 xl:col-span-4 xl:col-start-9 xl:row-span-2 xl:row-start-1"
          >
            <div className="flex items-baseline justify-between gap-3 pb-3">
              <h2 id="space-activity" className="label text-faint">
                Activity
              </h2>
              {shown.length > 0 ? (
                <span className="label tnum text-faint">{shown.length}</span>
              ) : null}
            </div>
            {activity.isPending ? (
              <p className="border-t rule pt-3 text-[13px] text-muted">Reading activity…</p>
            ) : activity.isError ? (
              <div className="border-t rule pt-3">
                <p className="text-[13px] text-muted">The activity could not be read.</p>
                <button
                  type="button"
                  className="mt-1 min-h-11 text-[12px] text-muted underline decoration-line-strong hover:text-ink pointer-fine:min-h-0"
                  onClick={() => void activity.refetch()}
                >
                  Retry
                </button>
              </div>
            ) : (
              <ul className="border-t rule">
                {shown.map((entry) => (
                  <li key={entry.id} className="border-b rule">
                    <Link
                      to={`/s/${detail.id}/o/${entry.id}`}
                      className="group flex min-h-11 flex-col gap-0.5 py-2.5"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-[14px]">
                        {entry.icon ? <ThingIcon icon={entry.icon} size="sm" /> : null}
                        <span className="truncate group-hover:text-accent">{entry.title}</span>
                      </span>
                      <span className="font-mono text-[length:var(--text-label)] text-faint">
                        {typeLabel(typeList, entry.type)} · {relativeTime(entry.at)}
                      </span>
                      <span className="font-mono text-[length:var(--text-label)] text-muted">
                        {changeSummary(entry)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}

        <section
          aria-labelledby="space-graph"
          className={cn(
            "rounded-[22px] border border-line bg-surface p-5 sm:p-6 xl:col-span-8 xl:col-start-1 xl:row-start-2",
            activity.isSuccess && written.length === 0 && "xl:col-span-12",
          )}
        >
          <div className="flex items-baseline justify-between gap-3 pb-3">
            <h2 id="space-graph" className="label text-faint">
              Graph
            </h2>
            {graph.data ? (
              <span className="label tnum text-faint">
                {graph.data.nodes.length} {graph.data.nodes.length === 1 ? "record" : "records"}
              </span>
            ) : null}
          </div>
          {graph.isError ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[13px] text-muted">The map could not be read.</p>
              <button
                type="button"
                className="min-h-11 text-[12px] text-muted underline decoration-line-strong hover:text-ink pointer-fine:min-h-0"
                onClick={() => void graph.refetch()}
              >
                Retry
              </button>
            </div>
          ) : graph.data ? (
            <SpaceGraph
              spaceId={detail.id}
              nodes={graph.data.nodes}
              edges={graph.data.edges}
              typeNames={typeNames}
            />
          ) : (
            <p className="text-[13px] text-muted">Drawing the space…</p>
          )}
        </section>
      </div>

      <footer className="mt-8 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-1 pt-4">
        <p className="font-mono text-[11px] text-faint">
          space.yml · {detail.timezone} · {shortId(detail.id)}
        </p>
        <Link
          to={`/s/${detail.id}/settings`}
          className="label py-1 text-faint transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
        >
          Settings
        </Link>
      </footer>
    </div>
  );
}

/**
 * What one write changed, in the product's own words. Known keys read as
 * words; a property keeps the key its owner gave it, which is the same spelling
 * the schema editor and the record's history use.
 */
function changeSummary(entry: ActivityEntry): string {
  if (entry.action === "create") {
    return "created";
  }
  if (entry.action === "complete") {
    return "completed";
  }
  if (entry.action === "restore") {
    return "restored";
  }
  if (entry.action === "delete") {
    return "trashed";
  }
  const keys = entry.changed.filter((key) => key !== "icon");
  if (keys.length === 0) {
    return "saved";
  }
  // A bare key reads as a stray token in the margin; the verb makes the line a
  // sentence about what happened, not a field name that leaked out.
  const named = keys.slice(0, NAMED_CHANGES).join(" · ");
  const rest = keys.length > NAMED_CHANGES ? ` +${keys.length - NAMED_CHANGES}` : "";
  return `changed ${named}${rest}`;
}

function TypeRow({ spaceId, type }: { spaceId: string; type: TypeSummary }) {
  // The key is minted from the name, so it usually repeats the name in another
  // alphabet; it earns the column only once the two actually differ. The count
  // says `records` for the same reason: `4 chores` under a row already called
  // Chore names the type a second time.
  const keyIsName = type.key === keyFromName(type.name);
  const records = `${type.object_count} ${type.object_count === 1 ? "record" : "records"}`;
  return (
    <li className="border-b rule">
      <Link
        to={`/s/${spaceId}/t/${type.key}`}
        className="group grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3 transition-colors hover:bg-raised/40 pointer-coarse:min-h-12"
      >
        <ThingIcon icon={type.icon} name={type.name} size="md" />
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate text-[15px] font-medium group-hover:text-accent">
            {type.name}
          </span>
          {keyIsName ? null : (
            <span className="truncate font-mono text-[length:var(--text-label)] tracking-[0.09em] text-faint uppercase sm:hidden">
              {type.key}
            </span>
          )}
        </span>
        <span className="flex items-baseline gap-3">
          {keyIsName ? null : (
            <span className="hidden w-20 shrink-0 font-mono text-[length:var(--text-label)] tracking-[0.09em] text-faint uppercase sm:inline">
              {type.key}
            </span>
          )}
          <span className="tnum shrink-0 text-[13px] text-muted">{records}</span>
          {type.schedule ? (
            <span className="label hidden shrink-0 text-accent sm:inline">Scheduled</span>
          ) : null}
          <ArrowRight
            aria-hidden
            size={14}
            className="shrink-0 text-faint transition-colors group-hover:text-accent"
          />
        </span>
      </Link>
    </li>
  );
}

function Onboarding({ spaceId, canEdit }: { spaceId: string; canEdit: boolean }) {
  return (
    <div className="mt-4 max-w-[58ch] border-b rule pb-6">
      <h3 className="text-[17px] font-medium">Start with a type</h3>
      <p className="mt-2 text-[13px] text-muted">
        A type is a table. Its properties are columns; its records are rows.
      </p>
      <ol className="mt-3 grid list-decimal gap-1 pl-5 text-[13px] text-muted marker:text-faint">
        <li>Create a type for what you keep track of.</li>
        <li>Add the properties you want to record.</li>
        <li>Add records to fill the table.</li>
      </ol>
      {canEdit ? (
        <div className="mt-4 grid gap-2">
          <Button
            className="w-fit"
            render={<Link to={`/s/${spaceId}/schema`} />}
          >
            Create your first type
          </Button>
          <p className="text-[12px] text-faint">
            CSV import appears on a type page once a type exists.
          </p>
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-muted">Ask an owner to create the first type.</p>
      )}
    </div>
  );
}
