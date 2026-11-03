import { Link2 } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { useTypes } from "@/api/queries";
import type {
  MentionBacklink,
  ObjectDetail,
  OutgoingLink,
  OutgoingMentionLink,
  OutgoingRelationLink,
  RelationBacklink,
} from "@/api/types";
import { GraphSection } from "@/components/graph-section";
import { ThingIcon } from "@/components/thing-icon";

interface LinksPanelProps {
  spaceId: string;
  /** The record as the read returned it, including its `with=links,backlinks` rows. */
  object: ObjectDetail;
}

/** What every row needs to name its target; the direction adds its own facts. */
interface LinkRow {
  id: string;
  type: string;
  title: string;
  icon?: string;
  type_icon?: string;
}

/** The type's display name, falling back to its key until the list is read. */
function typeName(names: ReadonlyMap<string, string>, row: LinkRow): string {
  return names.get(row.type) ?? row.type;
}

function RowShell({
  spaceId,
  row,
  children,
}: {
  spaceId: string;
  row: LinkRow;
  children: ReactNode;
}) {
  return (
    <li className="border-b rule last:border-b-0">
      <Link
        to={`/s/${spaceId}/o/${row.id}`}
        className="flex min-h-11 items-start gap-2.5 py-2.5 pr-1 transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent pointer-fine:min-h-0"
      >
        <ThingIcon icon={row.icon ?? row.type_icon} size="sm" className="mt-0.5" />
        <span className="grid min-w-0 flex-1 gap-0.5">{children}</span>
      </Link>
    </li>
  );
}

function RelationRow({
  spaceId,
  row,
  names,
}: {
  spaceId: string;
  row: RelationBacklink | OutgoingRelationLink;
  names: ReadonlyMap<string, string>;
}) {
  return (
    <RowShell spaceId={spaceId} row={row}>
      <span className="text-[15px]">{row.title}</span>
      <span className="text-[12px] text-muted">
        {typeName(names, row)} · via {row.property_name}
      </span>
    </RowShell>
  );
}

function MentionRow({
  spaceId,
  row,
  names,
  context,
}: {
  spaceId: string;
  row: MentionBacklink | OutgoingMentionLink;
  names: ReadonlyMap<string, string>;
  /** Why the row exists when the row itself carries no snippet. */
  context?: string;
}) {
  const count = "count" in row ? row.count : 0;
  const snippet = "snippet" in row ? row.snippet : undefined;
  return (
    <RowShell spaceId={spaceId} row={row}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[15px]">{row.title}</span>
        {count > 1 ? (
          <span className="shrink-0 font-mono text-[11px] text-faint tnum">×{count}</span>
        ) : null}
      </span>
      <span className="text-[12px] text-muted">
        {typeName(names, row)}
        {context ? ` · ${context}` : null}
      </span>
      {snippet ? <span className="line-clamp-2 text-[13px] text-muted">{snippet}</span> : null}
    </RowShell>
  );
}

/**
 * What this record points at and what points at it: relation properties and
 * body mentions in both directions. One fact is one row, so a target can carry
 * two rows of different kinds. The graph is shown whenever either direction has
 * a row, and it draws exactly the edges listed here.
 */
export function LinksPanel({ spaceId, object }: LinksPanelProps) {
  const types = useTypes(spaceId);
  const backlinks = object.backlinks ?? [];
  const linksTo: OutgoingLink[] = object.links_to ?? [];
  const outgoingRelations = linksTo.filter(
    (row): row is OutgoingRelationLink => row.kind === "relation",
  );
  const outgoingMentions = linksTo.filter(
    (row): row is OutgoingMentionLink => row.kind === "mention",
  );
  const incomingRelations = backlinks.filter(
    (row): row is RelationBacklink => row.kind === "relation",
  );
  const incomingMentions = backlinks.filter(
    (row): row is MentionBacklink => row.kind === "mention",
  );
  const total = backlinks.length + linksTo.length;
  const names = new Map((types.data ?? []).map((type) => [type.key, type.name]));

  return (
    <section aria-labelledby="links-heading" className="mt-10 border-t rule pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="links-heading" className="label flex items-center gap-1.5">
          <Link2 aria-hidden size={13} strokeWidth={1.5} className="text-muted" />
          Links
        </h2>
        {total > 0 ? <span className="font-mono text-[11px] text-faint tnum">{total}</span> : null}
      </div>

      {total === 0 ? (
        <p className="mt-3 max-w-[52ch] text-[13px] text-muted">
          No links yet. A relation property or{" "}
          <span className="font-mono text-[12px] text-ink">[[Type/Title]]</span> mention, in either
          direction, appears here.
        </p>
      ) : (
        <div id="links-rows" className="mt-3 grid gap-6">
          {linksTo.length > 0 ? (
            <div>
              <h3 className="label">Links to</h3>
              <ul className="mt-1 border-t rule">
                {outgoingRelations.map((row) => (
                  <RelationRow
                    key={`to-relation:${row.id}:${row.property}`}
                    spaceId={spaceId}
                    row={row}
                    names={names}
                  />
                ))}
                {outgoingMentions.map((row) => (
                  <MentionRow
                    key={`to-mention:${row.id}`}
                    spaceId={spaceId}
                    row={row}
                    names={names}
                    context="mentioned in this body"
                  />
                ))}
              </ul>
            </div>
          ) : null}
          {incomingRelations.length > 0 ? (
            <div>
              <h3 className="label">Linked from</h3>
              <ul className="mt-1 border-t rule">
                {incomingRelations.map((row) => (
                  <RelationRow
                    key={`from-relation:${row.id}:${row.property}`}
                    spaceId={spaceId}
                    row={row}
                    names={names}
                  />
                ))}
              </ul>
            </div>
          ) : null}
          {incomingMentions.length > 0 ? (
            <div>
              <h3 className="label">Mentioned in</h3>
              <ul className="mt-1 border-t rule">
                {incomingMentions.map((row) => (
                  <MentionRow
                    key={`from-mention:${row.id}`}
                    spaceId={spaceId}
                    row={row}
                    names={names}
                  />
                ))}
              </ul>
            </div>
          ) : null}
          <GraphSection
            spaceId={spaceId}
            center={{
              id: object.id,
              title: object.title,
              type: object.type,
              ...(object.icon === undefined ? {} : { icon: object.icon }),
            }}
            links={object.links}
            linksTo={object.links_to}
            backlinks={object.backlinks}
            typeNames={names}
          />
        </div>
      )}
    </section>
  );
}
