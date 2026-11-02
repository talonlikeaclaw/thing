import type { ReactNode } from "react";
import { Link } from "react-router";

import { useTypes } from "@/api/queries";
import type { Backlink, MentionBacklink, RelationBacklink } from "@/api/types";
import { ThingIcon } from "@/components/thing-icon";

interface LinksPanelProps {
  spaceId: string;
  /** Records that point here, through a relation property or a body link. */
  backlinks: Backlink[] | undefined;
}

/** The type's display name, falling back to its key until the list is read. */
function typeName(names: ReadonlyMap<string, string>, backlink: Backlink): string {
  return names.get(backlink.type) ?? backlink.type;
}

function RowShell({
  spaceId,
  backlink,
  children,
}: {
  spaceId: string;
  backlink: Backlink;
  children: ReactNode;
}) {
  return (
    <li className="border-b rule last:border-b-0">
      <Link
        to={`/s/${spaceId}/o/${backlink.id}`}
        className="flex min-h-11 items-start gap-2.5 py-2.5 pr-1 transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent pointer-fine:min-h-0"
      >
        <ThingIcon icon={backlink.icon ?? backlink.type_icon} size="sm" className="mt-0.5" />
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
  row: RelationBacklink;
  names: ReadonlyMap<string, string>;
}) {
  return (
    <RowShell spaceId={spaceId} backlink={row}>
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
}: {
  spaceId: string;
  row: MentionBacklink;
  names: ReadonlyMap<string, string>;
}) {
  return (
    <RowShell spaceId={spaceId} backlink={row}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[15px]">{row.title}</span>
        {row.count > 1 ? (
          <span className="shrink-0 font-mono text-[11px] text-faint tnum">×{row.count}</span>
        ) : null}
      </span>
      <span className="text-[12px] text-muted">{typeName(names, row)}</span>
      {row.snippet ? <span className="line-clamp-2 text-[13px] text-muted">{row.snippet}</span> : null}
    </RowShell>
  );
}

/**
 * What points at this record: relations that target it and bodies that link it.
 * Both kinds are one per source fact, so a record can hold two rows for one
 * source when a relation and a mention both exist.
 */
export function LinksPanel({ spaceId, backlinks }: LinksPanelProps) {
  const types = useTypes(spaceId);
  const rows = backlinks ?? [];
  const relations = rows.filter((row): row is RelationBacklink => row.kind === "relation");
  const mentions = rows.filter((row): row is MentionBacklink => row.kind === "mention");
  const names = new Map((types.data ?? []).map((type) => [type.key, type.name]));

  return (
    <section aria-labelledby="links-heading" className="mt-10 border-t rule pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="links-heading" className="label">
          Links
        </h2>
        {rows.length > 0 ? (
          <span className="font-mono text-[11px] text-faint tnum">{rows.length}</span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 max-w-[52ch] text-[13px] text-muted">
          No links yet. Add a relation property or write{" "}
          <span className="font-mono text-[12px] text-ink">[[Type/Title]]</span> in a body.
        </p>
      ) : (
        <div className="mt-3 grid gap-6">
          {relations.length > 0 ? (
            <div>
              <h3 className="label">Linked from</h3>
              <ul className="mt-1 border-t rule">
                {relations.map((row) => (
                  <RelationRow
                    key={`relation:${row.id}:${row.property}`}
                    spaceId={spaceId}
                    row={row}
                    names={names}
                  />
                ))}
              </ul>
            </div>
          ) : null}
          {mentions.length > 0 ? (
            <div>
              <h3 className="label">Mentioned in</h3>
              <ul className="mt-1 border-t rule">
                {mentions.map((row) => (
                  <MentionRow key={`mention:${row.id}`} spaceId={spaceId} row={row} names={names} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
