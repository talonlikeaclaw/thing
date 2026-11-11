import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useLocation, useParams, useSearchParams } from "react-router";

import { useProperties, useSpace, useType, useTypes } from "@/api/queries";
import { PropertyEditor } from "@/components/schema/property-editor";
import { PropertyList } from "@/components/schema/property-list";
import { TypeEditor } from "@/components/schema/type-editor";
import { TypeList } from "@/components/schema/type-list";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ErrorState } from "@/components/error-state";
import { useThumbHandedness } from "@/components/handedness";
import { PageHeader } from "@/components/ui/page";
import { cn } from "@/lib/cn";
import { useCompactWidth } from "@/lib/media";
import { useRouteMeta } from "@/lib/route";
import { effectiveProperties } from "@/lib/schema";

type SchemaTab = "types" | "properties";

/**
 * The schema library: two tabs, each a list beside its editor. A record's
 * `Properties › Manage` link and the columns panel name a type or a property
 * in the URL, and that selection decides the tab, so a deep link never lands
 * on a list it is not about.
 */
export function SchemaPage() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const properties = useProperties(spaceId);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const compact = useCompactWidth();
  const handedness = useThumbHandedness();

  const selectedTypeParam = params.get("type") ?? undefined;
  const selectedPropertyKey = params.get("property") ?? undefined;
  const tab: SchemaTab = selectedPropertyKey
    ? "properties"
    : selectedTypeParam
      ? "types"
      : params.get("tab") === "properties"
        ? "properties"
        : "types";

  /**
   * The type page's Edit action deep-links to `#type-editor`. On a phone there
   * is no side-by-side fallback to the first type, so the hash selects one
   * into the URL before the list paints; after that the editor scrolls into
   * view exactly as it did before the tabs existed.
   */
  const scrollToEditor = useRef(location.hash === "#type-editor");
  const deepLink = scrollToEditor.current;

  // Desktop keeps the old default: the first type is open beside the list.
  const selectedTypeKey = compact
    ? selectedTypeParam
    : (selectedTypeParam ?? types.data?.[0]?.key);
  const type = useType(spaceId, selectedTypeKey);
  const selectedProperty = properties.data?.find(
    (property) => property.key === selectedPropertyKey,
  );

  useEffect(() => {
    if (!deepLink || selectedTypeParam || !types.data?.length) {
      return;
    }
    const next = new URLSearchParams(params);
    next.set("tab", "types");
    next.set("type", types.data[0]!.key);
    setParams(next, { replace: true, preventScrollReset: true });
  }, [deepLink, selectedTypeParam, types.data, params, setParams]);

  useEffect(() => {
    if (!scrollToEditor.current || !type.data) {
      return;
    }
    scrollToEditor.current = false;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById("type-editor")
        ?.scrollIntoView({ block: "start", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [type.data]);

  /** Where the list was when a phone tapped into its editor. */
  const listScroll = useRef(0);

  const selectTab = useCallback(
    (nextTab: SchemaTab) => {
      const next = new URLSearchParams(params);
      next.set("tab", nextTab);
      if (nextTab === "types") {
        next.delete("property");
      } else {
        next.delete("type");
      }
      setParams(next, { replace: true, preventScrollReset: true });
    },
    [params, setParams],
  );

  function selectType(key: string) {
    listScroll.current = window.scrollY;
    const next = new URLSearchParams(params);
    next.set("tab", "types");
    next.set("type", key);
    next.delete("property");
    setParams(next, { replace: true, preventScrollReset: true });
    if (compact) {
      window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    }
  }

  function selectProperty(key: string) {
    listScroll.current = window.scrollY;
    const next = new URLSearchParams(params);
    next.set("tab", "properties");
    next.set("property", key);
    next.delete("type");
    setParams(next, { replace: true, preventScrollReset: true });
    if (compact) {
      window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    }
  }

  function back(nextTab: SchemaTab) {
    const y = listScroll.current;
    const next = new URLSearchParams(params);
    next.set("tab", nextTab);
    if (nextTab === "types") {
      next.delete("type");
    } else {
      next.delete("property");
    }
    setParams(next, { replace: true, preventScrollReset: true });
    window.requestAnimationFrame(() => window.scrollTo({ top: y }));
  }

  useRouteMeta("Schema");

  if (types.isPending || properties.isPending) {
    return <p className="text-[13px] text-muted">Reading the schema…</p>;
  }

  if (types.isError || properties.isError) {
    const error = types.error ?? properties.error;
    return (
      <ErrorState
        error={error}
        subject="Schema"
        onRetry={() => {
          void types.refetch();
          void properties.refetch();
        }}
      />
    );
  }

  const detail = space.data;
  if (!detail) {
    return <p className="text-[13px] text-muted">Reading the schema…</p>;
  }
  const canEdit = detail.role !== "viewer";
  const showTypeList = !compact || !selectedTypeParam;
  const showTypeEditor = !compact || Boolean(selectedTypeParam);
  const showPropertyList = !compact || !selectedPropertyKey;
  const showPropertyEditor = !compact || Boolean(selectedPropertyKey);

  return (
    <div className="settle">
      <Breadcrumbs
        items={[{ label: detail.name, to: `/s/${detail.id}` }, { label: "Schema" }]}
      />

      <PageHeader title="Schema" meta={detail.role} />

      <div
        className={cn(
          "mt-6 flex w-full",
          compact && (handedness === "left" ? "justify-start" : "justify-end"),
        )}
      >
        <div
          role="tablist"
          aria-label="Schema"
          className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full border border-line/80 bg-inset/60 p-1"
        >
          <SchemaTabButton
            selected={tab === "types"}
            count={types.data.length}
            onClick={() => selectTab("types")}
          >
            Types
          </SchemaTabButton>
          <SchemaTabButton
            selected={tab === "properties"}
            count={properties.data.length}
            onClick={() => selectTab("properties")}
          >
            Properties
          </SchemaTabButton>
        </div>
      </div>

      {tab === "types" ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-6">
          {showTypeList ? (
            <div className="self-start rounded-[22px] border border-line bg-surface p-4">
              <TypeList
                spaceId={detail.id}
                types={types.data}
                selectedKey={selectedTypeKey}
                canEdit={canEdit}
                onSelect={selectType}
                onCreated={selectType}
              />
            </div>
          ) : null}
          {showTypeEditor ? (
            <div className="min-w-0">
              {compact && selectedTypeParam ? (
                <BackButton label="Back to types" onClick={() => back("types")} />
              ) : null}
              <div
                id="type-editor"
                className="scroll-mt-6 rounded-[22px] border border-line bg-surface p-5"
              >
                {type.isPending && selectedTypeKey ? (
                  <p className="text-[13px] text-muted">Reading the type…</p>
                ) : type.isError ? (
                  <div className="grid gap-3">
                    <ErrorState
                      error={type.error}
                      subject="This type"
                      onRetry={() => void type.refetch()}
                    />
                  </div>
                ) : type.data ? (
                  <TypeEditor
                    key={type.data.key}
                    spaceId={detail.id}
                    type={type.data}
                    properties={effectiveProperties(type.data, properties.data)}
                    recordCount={
                      types.data.find((summary) => summary.key === type.data?.key)?.object_count ??
                      0
                    }
                    canEdit={canEdit}
                  />
                ) : (
                  <p className="max-w-[48ch] border-t rule pt-4 text-muted">
                    No type selected yet. Create a type to give this space its first table.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-6">
          {showPropertyList ? (
            <div className="self-start rounded-[22px] border border-line bg-surface p-4">
              <PropertyList
                spaceId={detail.id}
                properties={properties.data}
                types={types.data}
                selectedKey={selectedPropertyKey}
                canEdit={canEdit}
                onSelect={selectProperty}
                onCreated={selectProperty}
              />
            </div>
          ) : null}
          {showPropertyEditor ? (
            <div className="min-w-0">
              {compact && selectedPropertyKey ? (
                <BackButton
                  label="Back to properties"
                  onClick={() => back("properties")}
                />
              ) : null}
              <div className="rounded-[22px] border border-line bg-surface p-5">
                {selectedProperty ? (
                  <PropertyEditor
                    key={selectedProperty.key}
                    spaceId={detail.id}
                    property={selectedProperty}
                    types={types.data}
                    library={properties.data}
                    canEdit={canEdit}
                    onRenamed={selectProperty}
                  />
                ) : (
                  <p className="max-w-[48ch] text-[13px] text-muted">
                    Select a property to edit it, or create one to describe a new column. A
                    property's format is fixed once it exists; its name, options and colours stay
                    editable.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SchemaTabButton({
  selected,
  count,
  onClick,
  children,
}: {
  selected: boolean;
  count: number;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-[length:var(--text-small)] transition-colors pointer-coarse:min-h-11",
        selected
          ? "bg-accent-wash text-accent-on-wash"
          : "text-muted hover:bg-raised/60 hover:text-ink",
      )}
    >
      <span>{children}</span>
      <span className="tnum font-mono text-[length:var(--text-label)] text-faint">{count}</span>
    </button>
  );
}

/** The phone's way out of a master-detail editor, back to its list. */
function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-3 flex min-h-9 items-center gap-1.5 rounded-full px-2 text-[13px] text-muted transition-colors hover:text-ink pointer-coarse:min-h-11"
    >
      <ArrowLeft aria-hidden size={15} />
      {label}
    </button>
  );
}
