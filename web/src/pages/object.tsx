import { useParams, useSearchParams } from "react-router";

import { useObject, useProperties, useSpace, useType } from "@/api/queries";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DayDue } from "@/components/day-due";
import { DayStrip, useDayHotkeys } from "@/components/day-strip";
import { ErrorState } from "@/components/error-state";
import { HistoryPanel } from "@/components/history-panel";
import { LinksPanel } from "@/components/links-panel";
import { ObjectPanel } from "@/components/object-panel";
import { isDayTitle } from "@/lib/daily";
import { shortId } from "@/lib/display";
import { effectiveProperties } from "@/lib/schema";
import { useRouteMeta } from "@/lib/route";
import { todayIn } from "@/lib/timezone";

/** `/s/:spaceId/o/:objectId` — one record, its properties and its markdown body. */
export function ObjectPage() {
  const { spaceId, objectId } = useParams();
  const [params, setParams] = useSearchParams();
  const highlight = (params.get("q") ?? "").trim();
  const space = useSpace(spaceId);
  const properties = useProperties(spaceId);
  const object = useObject(spaceId, objectId);
  const type = useType(spaceId, object.data?.type);

  useRouteMeta(object.data?.title ?? "Record");

  /**
   * A daily note is recognised by its type and its title and by nothing else,
   * so the rail appears exactly where the journal's grammar holds: a renamed
   * note, or one of another type, is an ordinary record with no day to step.
   */
  const dailyType = space.data?.daily_type ?? null;
  const noteTitle = object.data?.title ?? "";
  const dailyDay =
    dailyType && type.data?.key === dailyType && isDayTitle(noteTitle) ? noteTitle : null;
  const spaceToday = space.data ? todayIn(space.data.timezone) : "";
  useDayHotkeys({ spaceId: spaceId ?? "", day: dailyDay, today: spaceToday });

  if (
    properties.isPending ||
    object.isPending ||
    (object.data !== undefined && type.isPending)
  ) {
    return <p className="text-[13px] text-muted">Reading the record…</p>;
  }

  const error = properties.error ?? object.error ?? type.error;
  if (error) {
    return (
      <ErrorState
        error={error}
        subject="Record"
        onRetry={() => {
          void properties.refetch();
          void object.refetch();
          void type.refetch();
        }}
      />
    );
  }

  const detail = space.data;
  const propertiesData = properties.data;
  const record = object.data;
  if (!detail || !propertiesData || !record || !type.data) {
    return <p className="text-[13px] text-muted">Reading the record…</p>;
  }

  const typeData = type.data;

  return (
    <div className="settle">
      <Breadcrumbs
        items={[
          { label: detail.name, to: `/s/${detail.id}` },
          { label: typeData.name_plural, to: `/s/${detail.id}/t/${typeData.key}` },
          { label: record.title },
        ]}
      />
      {dailyDay ? (
        <DayStrip spaceId={detail.id} day={dailyDay} today={spaceToday} />
      ) : null}
      <ObjectPanel
        key={record.id}
        spaceId={detail.id}
        type={typeData}
        object={record}
        properties={effectiveProperties(typeData, propertiesData)}
        library={propertiesData}
        canEdit={detail.role !== "viewer"}
        timeZone={detail.timezone}
        reloadObject={async () => (await object.refetch()).data}
        highlight={highlight}
        dayContext={dailyDay ? <DayDue spaceId={detail.id} day={dailyDay} /> : undefined}
        onClearHighlight={
          highlight === ""
            ? undefined
            : () => {
                const next = new URLSearchParams(params);
                next.delete("q");
                setParams(next, { replace: true });
              }
        }
      >
        <LinksPanel spaceId={detail.id} object={record} />
        <HistoryPanel
          spaceId={detail.id}
          objectId={record.id}
          properties={effectiveProperties(typeData, propertiesData)}
          memberName={(userId) =>
            detail.members.find((member) => member.user === userId)?.name ?? shortId(userId)
          }
          timeZone={detail.timezone}
        />
      </ObjectPanel>
    </div>
  );
}
