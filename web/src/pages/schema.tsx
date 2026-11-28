import { ArrowLeft, Plus } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";

import { useProperties, useSpace, useType, useTypes } from "@/api/queries";
import { PropertyEditor } from "@/components/schema/property-editor";
import {
  PropertyCreateForm,
  PropertyList,
} from "@/components/schema/property-list";
import { TypeEditor } from "@/components/schema/type-editor";
import { TypeCreateForm, TypeList } from "@/components/schema/type-list";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/controls";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { cn } from "@/lib/cn";
import { useCompactWidth } from "@/lib/media";
import { whenScrollUnlocked } from "@/lib/scroll-lock";
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

  const canEdit = space.data ? space.data.role !== "viewer" : false;
  const requestedNew = params.get("new");
  const creatingType = requestedNew === "type" && canEdit;
  const creatingProperty = requestedNew === "property" && canEdit;
  const selectedTypeParam = params.get("type") ?? undefined;
  const selectedPropertyKey = params.get("property") ?? undefined;
  const activeTypeParam = creatingType ? undefined : selectedTypeParam;
  const activePropertyKey = creatingProperty ? undefined : selectedPropertyKey;
  const tab: SchemaTab =
    requestedNew === "property"
      ? "properties"
      : requestedNew === "type"
        ? "types"
        : selectedPropertyKey
          ? "properties"
          : selectedTypeParam
            ? "types"
            : params.get("tab") === "properties"
              ? "properties"
              : "types";

  /**
   * The type page's Edit action deep-links to `#type-editor`, and a generated
   * column's edit action to `#type-schedule`. On a phone there is no
   * side-by-side fallback to the first type, so the hash selects one into the
   * URL before the list paints; after that the named block scrolls into view.
   */
  const scrollTarget = useRef(
    location.hash.length > 1 ? location.hash.slice(1) : null,
  );
  const deepLink = scrollTarget.current !== null;

  // Desktop keeps the old default: the first type is open beside the list.
  // A create form owns the editor column instead, so no type is selected.
  const selectedTypeKey = creatingType
    ? undefined
    : compact
      ? selectedTypeParam
      : (selectedTypeParam ?? types.data?.[0]?.key);
  const type = useType(spaceId, selectedTypeKey);
  const selectedProperty = properties.data?.find(
    (property) => property.key === activePropertyKey,
  );

  useEffect(() => {
    if (!deepLink || creatingType || selectedTypeParam || !types.data?.length) {
      return;
    }
    const next = new URLSearchParams(params);
    next.set("tab", "types");
    next.set("type", types.data[0]!.key);
    setParams(next, { replace: true, preventScrollReset: true });
  }, [deepLink, creatingType, selectedTypeParam, types.data, params, setParams]);

  useEffect(() => {
    const target = scrollTarget.current;
    if (target === null || !type.data) {
      return;
    }
    // The ref is consumed by the scroll itself: a refetch can re-run this
    // effect before the sheet releases, and clearing it early would drop the
    // deep link on the floor.
    return whenScrollUnlocked(() => {
      if (scrollTarget.current !== target) {
        return;
      }
      scrollTarget.current = null;
      document
        .getElementById(target)
        ?.scrollIntoView({ block: "start", inline: "nearest" });
    });
  }, [type.data]);

  // A pathname change moves focus to the new page's h1 in the shell. A create
  // deep link must land in its first field instead, so take focus back on the
  // next frame, after that heading focus. Focusing the field is also what
  // brings an inline phone form or the editor column into view; a start-aligned
  // scroll would push the page header under the chrome on a wide screen.
  useEffect(() => {
    if (!creatingType && !creatingProperty) {
      return;
    }
    const id = creatingType ? "type-name" : "property-name";
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(id)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [creatingType, creatingProperty]);

  /** Where the list was when a phone tapped into its editor. */
  const listScroll = useRef(0);

  const selectTab = useCallback(
    (nextTab: SchemaTab) => {
      const next = new URLSearchParams(params);
      next.set("tab", nextTab);
      next.delete("new");
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
    next.delete("new");
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
    next.delete("new");
    setParams(next, { replace: true, preventScrollReset: true });
    if (compact) {
      window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    }
  }

  /** New type on a wide screen opens in the editor column, not the list. */
  function startCreateType() {
    const next = new URLSearchParams(params);
    next.set("tab", "types");
    next.set("new", "type");
    next.delete("type");
    next.delete("property");
    setParams(next, { replace: true, preventScrollReset: true });
  }

  /** New property on a wide screen opens in the editor column, not the list. */
  function startCreateProperty() {
    const next = new URLSearchParams(params);
    next.set("tab", "properties");
    next.set("new", "property");
    next.delete("property");
    next.delete("type");
    setParams(next, { replace: true, preventScrollReset: true });
  }

  /** Closing a create form keeps the reader on the tab they opened it from. */
  function stopCreating(nextTab: SchemaTab) {
    const next = new URLSearchParams(params);
    next.delete("new");
    next.set("tab", nextTab);
    setParams(next, { replace: true, preventScrollReset: true });
  }

  function back(nextTab: SchemaTab) {
    const y = listScroll.current;
    const next = new URLSearchParams(params);
    next.set("tab", nextTab);
    next.delete("new");
    if (nextTab === "types") {
      next.delete("type");
    } else {
      next.delete("property");
    }
    setParams(next, { replace: true, preventScrollReset: true });
    window.requestAnimationFrame(() => window.scrollTo({ top: y }));
  }

  /**
   * The WAI-ARIA tabs pattern: one tab in the tab order, arrows and
   * Home/End select and move focus. The selected tab owns the panel.
   */
  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const order: SchemaTab[] = ["types", "properties"];
    const index = order.indexOf(tab);
    let next: SchemaTab;
    switch (event.key) {
      case "ArrowRight":
        next = order[(index + 1) % order.length]!;
        break;
      case "ArrowLeft":
        next = order[(index - 1 + order.length) % order.length]!;
        break;
      case "Home":
        next = order[0]!;
        break;
      case "End":
        next = order[order.length - 1]!;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectTab(next);
    document.getElementById(`schema-tab-${next}`)?.focus();
  }

  useRouteMeta("Types & properties");

  if (types.isPending || properties.isPending) {
    return <p className="text-[13px] text-muted">Reading types and properties…</p>;
  }

  if (types.isError || properties.isError) {
    const error = types.error ?? properties.error;
    return (
      <ErrorState
        error={error}
        subject="Types & properties"
        onRetry={() => {
          void types.refetch();
          void properties.refetch();
        }}
      />
    );
  }

  const detail = space.data;
  if (!detail) {
    return <p className="text-[13px] text-muted">Reading types and properties…</p>;
  }
  const showTypeList = !compact || !activeTypeParam;
  const showTypeEditor = compact ? Boolean(activeTypeParam) : true;
  const showPropertyList = !compact || !activePropertyKey;
  const showPropertyEditor = compact ? Boolean(activePropertyKey) : true;

  return (
    <div className="settle">
      <Breadcrumbs
        items={[
          { label: detail.name, to: `/s/${detail.id}` },
          { label: "Types & properties" },
        ]}
      />

      <PageHeader
        title="Types & properties"
        meta={detail.role === "viewer" ? "viewer" : undefined}
        titleActions={[
          <div key="tabs" className="flex">
            <div
              role="tablist"
              aria-label="Types & properties"
              onKeyDown={handleTabKeyDown}
              className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full border border-line/80 bg-inset/60 p-1"
            >
              <SchemaTabButton
                id="schema-tab-types"
                controls="schema-panel-types"
                tabIndex={tab === "types" ? 0 : -1}
                selected={tab === "types"}
                count={types.data.length}
                onClick={() => selectTab("types")}
              >
                Types
              </SchemaTabButton>
              <SchemaTabButton
                id="schema-tab-properties"
                controls="schema-panel-properties"
                tabIndex={tab === "properties" ? 0 : -1}
                selected={tab === "properties"}
                count={properties.data.length}
                onClick={() => selectTab("properties")}
              >
                Properties
              </SchemaTabButton>
            </div>
          </div>,
          canEdit && !creatingType && !creatingProperty ? (
            <Button
              key="new"
              variant="ghost"
              render={
                <Link
                  to={`/s/${detail.id}/schema?new=${tab === "types" ? "type" : "property"}`}
                />
              }
            >
              <Plus aria-hidden size={15} className="shrink-0" />
              {tab === "types" ? "New type" : "New property"}
            </Button>
          ) : null,
        ]}
        line={`${types.data.length} ${types.data.length === 1 ? "type" : "types"} · ${properties.data.length} ${properties.data.length === 1 ? "property" : "properties"}`}
      />

      {tab === "types" ? (
        <div
          role="tabpanel"
          id="schema-panel-types"
          aria-labelledby="schema-tab-types"
          className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-6"
        >
          {showTypeList ? (
            <div className="self-start rounded-[22px] border border-line bg-surface p-4">
              <TypeList
                spaceId={detail.id}
                types={types.data}
                selectedKey={selectedTypeKey}
                canEdit={canEdit}
                onSelect={selectType}
                onCreated={selectType}
                creating={creatingType}
                onCreatingChange={(next) =>
                  next ? startCreateType() : stopCreating("types")
                }
                inlineCreate={compact}
              />
            </div>
          ) : null}
          {showTypeEditor ? (
            <div className="min-w-0">
              {compact && activeTypeParam ? (
                <BackButton label="Back to types" onClick={() => back("types")} />
              ) : null}
              {/* The record page and the columns panel deep-link to this id. */}
              <div id="type-editor" className="scroll-mt-[calc(var(--shell-header-h)+1rem)] rounded-[22px] border border-line bg-surface p-5">
                {creatingType ? (
                  <TypeCreateForm
                    spaceId={detail.id}
                    onCreated={selectType}
                    onCancel={() => stopCreating("types")}
                  />
                ) : type.isPending && selectedTypeKey ? (
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
        <div
          role="tabpanel"
          id="schema-panel-properties"
          aria-labelledby="schema-tab-properties"
          className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-6"
        >
          {showPropertyList ? (
            <div className="self-start rounded-[22px] border border-line bg-surface p-4">
              <PropertyList
                spaceId={detail.id}
                properties={properties.data}
                types={types.data}
                selectedKey={activePropertyKey}
                canEdit={canEdit}
                onSelect={selectProperty}
                onCreated={selectProperty}
                creating={creatingProperty}
                onCreatingChange={(next) =>
                  next ? startCreateProperty() : stopCreating("properties")
                }
                inlineCreate={compact}
              />
            </div>
          ) : null}
          {showPropertyEditor ? (
            <div className="flex min-w-0 flex-col">
              {compact && activePropertyKey ? (
                <BackButton
                  label="Back to properties"
                  onClick={() => back("properties")}
                />
              ) : null}
              <div className="flex min-h-[18rem] flex-1 flex-col rounded-[22px] border border-line bg-surface p-5">
                {creatingProperty ? (
                  <PropertyCreateForm
                    spaceId={detail.id}
                    properties={properties.data}
                    types={types.data}
                    canEdit={canEdit}
                    onCreated={selectProperty}
                    onCancel={() => stopCreating("properties")}
                  />
                ) : selectedProperty ? (
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
                  <EmptyState
                    sentence="Select a property to edit it. A property's format is fixed once it exists; its name, options and colours stay editable."
                    action={
                      canEdit ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={startCreateProperty}
                        >
                          New property
                        </Button>
                      ) : undefined
                    }
                  />
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
  id,
  controls,
  tabIndex,
  selected,
  count,
  onClick,
  children,
}: {
  id: string;
  controls: string;
  tabIndex: number;
  selected: boolean;
  count: number;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-controls={controls}
      aria-selected={selected}
      tabIndex={tabIndex}
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
