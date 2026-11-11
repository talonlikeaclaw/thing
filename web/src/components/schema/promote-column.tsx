import { Dialog } from "@base-ui/react/dialog";
import { Check, Download, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  usePromoteColumn,
  useProperties,
  useTypes,
} from "@/api/queries";
import type {
  PromotePlan,
  PromoteRequest,
  PromoteStage,
  PropertyDef,
} from "@/api/types";
import { IconPicker } from "@/components/icon-picker";
import { Button, FormError, TextField } from "@/components/ui/controls";
import {
  SheetCloseButton,
  SheetFooter,
  SheetHeader,
  SheetPopup,
  SheetTitle,
  SheetViewport,
} from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";
import { temporaryKey } from "@/lib/promotion";

type Step = "target" | "preview" | "run";
type RunStage = Extract<PromoteStage, "targets" | "links" | "finish">;

const RUN_ORDER: RunStage[] = ["targets", "links", "finish"];
const SAMPLE_LIMIT = 20;

interface PromoteColumnDialogProps {
  spaceId: string;
  /** The type that carries the source column. */
  typeKey: string;
  property: PropertyDef;
  onClose: () => void;
}

/**
 * Turns one text, select or multi-select column into a relation to a new type.
 *
 * Step one names the type and relation. Step two reads the server's plan: every
 * count, the sample values, the views that move and the filters that drop.
 * Step three runs `targets → links → finish`; each stage skips what an earlier
 * run already wrote, so Retry and a reopened wizard resume instead of
 * duplicating a type, a record or a link.
 */
export function PromoteColumnDialog({
  spaceId,
  typeKey,
  property,
  onClose,
}: PromoteColumnDialogProps) {
  const promote = usePromoteColumn(spaceId, typeKey);
  const properties = useProperties(spaceId);
  const types = useTypes(spaceId);
  const toast = useToast();

  const [step, setStep] = useState<Step>("target");
  const [targetName, setTargetName] = useState(property.name);
  const [targetPlural, setTargetPlural] = useState("");
  const [targetIcon, setTargetIcon] = useState("");
  const [relationName, setRelationName] = useState(property.name);
  const [multi, setMulti] = useState(true);
  const [split, setSplit] = useState("");
  const [plan, setPlan] = useState<PromotePlan | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [running, setRunning] = useState<RunStage | null>(null);
  const [done, setDone] = useState<RunStage[]>([]);
  const [runTarget, setRunTarget] = useState<string | null>(null);
  const [created, setCreated] = useState<number | null>(null);
  const [linked, setLinked] = useState<number | null>(null);
  const [failure, setFailure] = useState<{ stage: RunStage; message: string } | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  // A temporary relation means an earlier run got at least to `links`; adopt
  // its type and relation so reopening continues that run rather than planning
  // a second type.
  const temporary = properties.data?.find((entry) => entry.key === temporaryKey(property.key));
  const resumeKey =
    temporary?.format === "relation" ? (temporary.target_type ?? null) : null;
  const resumedType = resumeKey
    ? types.data?.find((entry) => entry.key === resumeKey)
    : undefined;

  useEffect(() => {
    if (prefilled || !resumeKey || !resumedType) {
      return;
    }
    setTargetName(resumedType.name);
    setTargetPlural(resumedType.name_plural);
    setTargetIcon(resumedType.icon ?? "");
    setRelationName(temporary?.name ?? property.name);
    setMulti(temporary?.multi ?? true);
    setPrefilled(true);
  }, [prefilled, resumeKey, resumedType, temporary, property.name]);

  const isText = property.format === "text";
  const locked = running !== null;
  const target = useMemo(
    () => ({
      name: targetName.trim(),
      ...(targetPlural.trim() === "" ? {} : { name_plural: targetPlural.trim() }),
      ...(targetIcon.trim() === "" ? {} : { icon: targetIcon.trim() }),
    }),
    [targetName, targetPlural, targetIcon],
  );
  const body = (stage: PromoteStage): PromoteRequest => ({
    stage,
    property: property.key,
    target,
    ...(resumeKey ? { target_type: resumeKey } : {}),
    relation_name: relationName.trim(),
    multi,
    ...(isText && split.trim() !== "" ? { split: split.trim() } : {}),
  });
  const ready = target.name !== "" && relationName.trim() !== "";
  const blocked = (plan?.blocking.length ?? 0) > 0;
  const warningsOpen = (plan?.warnings.length ?? 0) > 0 && !acknowledged;
  const canCreate = plan !== null && !blocked && !warningsOpen;

  async function preview() {
    if (!ready) {
      return;
    }
    setFailure(null);
    try {
      const next = await promote.plan.mutateAsync(body("plan"));
      setPlan(next);
      setAcknowledged(false);
      setStep("preview");
    } catch {
      // The mutation's error renders under the Target step.
    }
  }

  async function execute(from: RunStage) {
    if (!plan) {
      return;
    }
    setFailure(null);
    const completed = new Set(done);
    let targetKey = runTarget ?? (plan.target.create ? null : plan.target.key);
    const start = RUN_ORDER.indexOf(from);
    for (const stage of RUN_ORDER.slice(start)) {
      if (completed.has(stage)) {
        continue;
      }
      setRunning(stage);
      try {
        if (stage === "targets") {
          const result = await promote.targets.mutateAsync(body("targets"));
          targetKey = result.type;
          setRunTarget(result.type);
          setCreated(result.created);
        } else if (stage === "links") {
          if (targetKey === null) {
            targetKey = plan.target.key;
          }
          const result = await promote.links.mutateAsync({
            ...body("links"),
            target_type: targetKey,
          });
          setLinked(result.links);
        } else {
          if (targetKey === null) {
            targetKey = plan.target.key;
          }
          await promote.finish.mutateAsync({ ...body("finish"), target_type: targetKey });
        }
        completed.add(stage);
        setDone([...completed]);
      } catch (error) {
        setFailure({ stage, message: readError(error) });
        setRunning(null);
        return;
      }
    }
    setRunning(null);
    toast.showToast(`Turned “${property.name}” into a relation to ${plan.target.name}.`);
    onClose();
  }

  function run() {
    setStep("run");
    void execute("targets");
  }

  const title =
    step === "target"
      ? `Turn ${property.name} into a relation`
      : step === "preview"
        ? "Preview the migration"
        : "Run the migration";

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !locked) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[55] scrim" />
        <SheetViewport className="z-[60]">
          <SheetPopup className="sm:w-[42rem]">
            <SheetHeader>
              <SheetTitle className="min-w-0 flex-1 truncate">{title}</SheetTitle>
              <SheetCloseButton
                label="Close conversion"
                disabled={locked}
                className="pointer-coarse:min-h-11"
              />
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--space-4)] py-[var(--space-3)]">
              <ol aria-label="Migration steps" className="mb-4 flex flex-wrap gap-x-4 gap-y-1">
                {(["target", "preview", "run"] as Step[]).map((value, index) => {
                  const current = step === value;
                  const complete =
                    (value === "target" && step !== "target") ||
                    (value === "preview" && step === "run");
                  return (
                    <li
                      key={value}
                      aria-current={current ? "step" : undefined}
                      className={cn(
                        "flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.09em]",
                        current ? "text-accent" : complete ? "text-muted" : "text-faint",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-4 items-center justify-center rounded-full border text-[9px]",
                          current
                            ? "border-accent text-accent"
                            : complete
                              ? "border-accent bg-accent-wash text-accent-on-wash"
                              : "border-line-strong",
                        )}
                      >
                        {complete ? <Check size={10} /> : index + 1}
                      </span>
                      {value === "target" ? "Target" : value === "preview" ? "Preview" : "Run"}
                    </li>
                  );
                })}
              </ol>

              {step === "target" ? (
                <div className="grid gap-4">
                  <p className="max-w-[62ch] text-[13px] text-muted">
                    A new type holds one record per distinct value. The column keeps its name
                    and key, and every old value stays in each record's history.
                  </p>
                  <TextField
                    label="Type name"
                    name="promote-target-name"
                    required
                    maxLength={200}
                    autoFocus
                    disabled={locked}
                    value={targetName}
                    onChange={(event) => setTargetName(event.target.value)}
                    placeholder="Artist"
                  />
                  <TextField
                    label="Plural"
                    name="promote-target-plural"
                    maxLength={200}
                    disabled={locked}
                    value={targetPlural}
                    onChange={(event) => setTargetPlural(event.target.value)}
                    placeholder={targetName.trim() === "" ? "Artists" : `${targetName.trim()}s`}
                    hint="Left empty, the server appends s."
                  />
                  <div>
                    <span className="label mb-1.5 block">Icon</span>
                    <IconPicker
                      variant="glyph"
                      label="Type icon"
                      value={targetIcon}
                      onChange={setTargetIcon}
                      disabled={locked}
                    />
                  </div>
                  <TextField
                    label="Relation name"
                    name="promote-relation-name"
                    required
                    maxLength={200}
                    disabled={locked}
                    value={relationName}
                    onChange={(event) => setRelationName(event.target.value)}
                  />
                  <label className="flex min-h-10 items-center gap-2 text-[13px] pointer-coarse:min-h-11">
                    <input
                      type="checkbox"
                      checked={multi}
                      disabled={locked || property.format === "multi_select"}
                      onChange={(event) => setMulti(event.target.checked)}
                    />
                    Several targets per record
                  </label>
                  {isText ? (
                    <TextField
                      label="Split on"
                      name="promote-split"
                      maxLength={8}
                      disabled={locked || !multi}
                      value={split}
                      onChange={(event) => setSplit(event.target.value)}
                      placeholder=","
                      hint="Optional. One cell becomes several targets; needs several targets per record."
                    />
                  ) : null}
                  <FormError
                    message={promote.plan.error ? readError(promote.plan.error) : null}
                  />
                </div>
              ) : null}

              {step === "preview" && plan ? (
                <div className="grid gap-4">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
                    <Count label="Records" value={plan.source.records} />
                    <Count label="Distinct values" value={plan.source.distinct} />
                    <Count label="Empty" value={plan.source.empty} />
                    <Count label="Links" value={plan.links} />
                    <Count
                      label="Target records"
                      value={plan.target.create_records}
                      hint={plan.target.create ? "to create" : "to reuse"}
                    />
                    <Count label="Views" value={plan.views.length} />
                  </dl>

                  {plan.source.trashed > 0 ? (
                    <p className="text-[12px] text-muted">
                      Records include {plan.source.trashed} in Trash; their values migrate too, so
                      a restore keeps them.
                    </p>
                  ) : null}

                  {blocked ? (
                    <div className="border-l border-danger pl-3">
                      <p className="label text-danger">This column cannot be promoted</p>
                      <ul className="mt-1 grid gap-1 text-[13px] text-danger">
                        {plan.blocking.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {plan.warnings.length > 0 ? (
                    <div className="border-l border-warning pl-3">
                      <p className="label text-warning">Before you create</p>
                      <ul className="mt-1 grid gap-1 text-[13px]">
                        {plan.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                      <label className="mt-2 flex min-h-10 items-center gap-2 text-[13px] pointer-coarse:min-h-11">
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          disabled={locked}
                          onChange={(event) => setAcknowledged(event.target.checked)}
                        />
                        I understand these warnings.
                      </label>
                    </div>
                  ) : null}

                  <section aria-label="Distinct values">
                    <p className="label mb-1.5">Values</p>
                    <div className="max-h-64 overflow-y-auto border-y rule">
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr className="text-left">
                            <th scope="col" className="py-1.5 pr-3 font-medium text-muted">
                              Value
                            </th>
                            <th scope="col" className="py-1.5 pr-3 font-medium text-muted">
                              Records
                            </th>
                            <th scope="col" className="py-1.5 font-medium text-muted">
                              Target
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {plan.target.values.slice(0, SAMPLE_LIMIT).map((value) => (
                            <tr key={value.title} className="border-t rule">
                              <td className="py-1.5 pr-3 text-ink">{value.title}</td>
                              <td className="tnum py-1.5 pr-3 font-mono text-[12px] text-muted">
                                {value.records}
                              </td>
                              <td className="py-1.5 text-[12px] text-muted">
                                {value.exists ? "reuse" : "create"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {plan.target.values.length > SAMPLE_LIMIT ? (
                      <p className="mt-1 text-[12px] text-faint">
                        and {plan.target.values.length - SAMPLE_LIMIT} more
                      </p>
                    ) : null}
                  </section>

                  {plan.views.length > 0 ? (
                    <section aria-label="Views that change">
                      <p className="label mb-1.5">Views</p>
                      <ul className="grid gap-1 text-[13px]">
                        {plan.views.map((view) => (
                          <li key={view.key} className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-ink">{view.name}</span>
                            <span className="text-muted">
                              {[
                                view.columns ? "columns move" : "",
                                view.sorts > 0
                                  ? `${view.sorts} ${view.sorts === 1 ? "sort" : "sorts"} move`
                                  : "",
                                view.filters_moved > 0
                                  ? `${view.filters_moved} ${
                                      view.filters_moved === 1 ? "filter" : "filters"
                                    } move`
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                            {view.filters_dropped > 0 ? (
                              <span className="inline-flex items-center gap-1 text-warning">
                                <TriangleAlert aria-hidden size={12} />
                                {view.filters_dropped}{" "}
                                {view.filters_dropped === 1 ? "filter" : "filters"} drop
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  <a
                    href={`/api/spaces/${spaceId}/types/${typeKey}/export`}
                    download={`thing-${typeKey}-${new Date().toISOString().slice(0, 10)}.csv`}
                    className="inline-flex min-h-9 w-fit items-center gap-2 rounded-full border border-line-interactive/70 px-3 text-[13px] text-ink transition-colors hover:border-line-strong pointer-coarse:min-h-11"
                  >
                    <Download aria-hidden size={14} />
                    Download CSV backup
                  </a>

                  {promote.plan.error ? (
                    <FormError message={readError(promote.plan.error)} />
                  ) : null}
                </div>
              ) : null}

              {step === "run" && plan ? (
                <div className="grid gap-4">
                  <ol aria-label="Run progress" className="grid gap-2">
                    {RUN_ORDER.map((stage) => {
                      const failed = failure?.stage === stage;
                      const complete = done.includes(stage);
                      const active = running === stage;
                      return (
                        <li
                          key={stage}
                          data-status={
                            failed ? "error" : complete ? "done" : active ? "running" : "pending"
                          }
                          className={cn(
                            "flex items-baseline gap-2 text-[13px]",
                            failed
                              ? "text-danger"
                              : complete
                                ? "text-muted"
                                : active
                                  ? "text-ink"
                                  : "text-faint",
                          )}
                        >
                          <span aria-hidden className="flex size-4 shrink-0 justify-center">
                            {complete ? (
                              <Check size={13} className="text-accent" />
                            ) : (
                              <span
                                className={cn(
                                  "mt-1.5 size-1.5 rounded-full",
                                  failed
                                    ? "bg-danger"
                                    : active
                                      ? "bg-accent"
                                      : "bg-line-strong",
                                )}
                              />
                            )}
                          </span>
                          <span>{stageLine(stage)}</span>
                        </li>
                      );
                    })}
                  </ol>

                  {created !== null ? (
                    <p className="text-[13px] text-muted">
                      {created === 0
                        ? `Every record of ${plan.target.name} already exists.`
                        : `${created} ${plan.target.name} ${
                            created === 1 ? "record" : "records"
                          } created.`}
                    </p>
                  ) : null}
                  {linked !== null ? (
                    <p className="text-[13px] text-muted">
                      {linked === 0
                        ? "Every record is already linked."
                        : `${linked} ${linked === 1 ? "record" : "records"} linked through ${
                            plan.relation.key
                          }.`}
                    </p>
                  ) : null}

                  {failure ? (
                    <div className="grid gap-2">
                      <p className="label text-danger">
                        <TriangleAlert aria-hidden size={12} className="inline" />{" "}
                        {stageStory(failure.stage)}
                      </p>
                      <FormError message={failure.message} />
                      <p className="text-[13px] text-muted">
                        What already succeeded is kept. Retry finishes without creating a second
                        type, record or link; you can also close and resume later.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <SheetFooter className="flex flex-wrap items-center gap-2">
              {step === "target" ? (
                <>
                  <Button
                    type="button"
                    disabled={!ready || promote.plan.isPending}
                    onClick={() => void preview()}
                  >
                    {promote.plan.isPending ? "Planning…" : "Preview migration"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                </>
              ) : null}
              {step === "preview" ? (
                <>
                  <Button
                    type="button"
                    disabled={!canCreate || locked}
                    onClick={run}
                  >
                    Create {plan?.target.name}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setStep("target")}>
                    Back
                  </Button>
                </>
              ) : null}
              {step === "run" ? (
                <>
                  {failure ? (
                    <Button
                      type="button"
                      disabled={locked}
                      onClick={() => void execute(failure.stage)}
                    >
                      {locked ? "Retrying…" : "Retry"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={locked}
                    onClick={onClose}
                  >
                    {failure ? "Close and resume later" : "Close"}
                  </Button>
                </>
              ) : null}
            </SheetFooter>
          </SheetPopup>
        </SheetViewport>
      </Dialog.Portal>
    </Dialog.Root>
  );

  function stageLine(stage: RunStage): string {
    if (!plan) {
      return stage;
    }
    if (stage === "targets") {
      return plan.target.create_records === 0
        ? `Reuse ${plan.target.name} and its records`
        : `Create ${plan.target.name} and ${plan.target.create_records} ${
            plan.target.create_records === 1 ? "record" : "records"
          }`;
    }
    if (stage === "links") {
      return `Link ${plan.links} ${plan.links === 1 ? "record" : "records"} through ${
        plan.relation.key
      }`;
    }
    return `Remove ${plan.source.key} and restore the key`;
  }
}

function Count({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="tnum mt-0.5 font-mono text-[15px] text-ink">
        {value}
        {hint ? <span className="ml-1 font-sans text-[11px] text-faint">{hint}</span> : null}
      </dd>
    </div>
  );
}

function stageStory(stage: RunStage): string {
  if (stage === "targets") {
    return "Could not create the target type and its records.";
  }
  if (stage === "links") {
    return "Could not link the records through the temporary relation.";
  }
  return "Could not remove the old column and restore the key.";
}
