import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router";

import {
  useCreateObject,
  useMe,
  useProperties,
  useSpace,
  useType,
  useTypes,
} from "@/api/queries";
import { useHandedness } from "@/components/handedness";
import { IconPicker } from "@/components/icon-picker";
import { PropertyField } from "@/components/property-field";
import { Button } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import {
  captureFields,
  captureTypeKey,
  readCaptureType,
  writeCaptureType,
} from "@/lib/capture";
import { cn } from "@/lib/cn";
import { readApiProblems, readError } from "@/lib/display";
import { isBlank, valueLabel } from "@/lib/format";
import { isApplePlatform } from "@/lib/hotkeys";

interface QuickCaptureApi {
  /** Opens the sheet, optionally preferring one type. */
  open: (typeKey?: string) => void;
  close: () => void;
  isOpen: boolean;
  /** False for a viewer or outside a space: no trigger, no shortcut. */
  available: boolean;
}

const QuickCaptureContext = createContext<QuickCaptureApi | null>(null);

const control =
  "h-10 w-full rounded-field border border-line-interactive bg-ground px-3 text-[15px] text-ink transition-colors hover:border-line-strong focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]";

/**
 * The app-wide quick capture sheet: one title, the type's required fields and
 * every other editable field in a compact grid, Create and Create and open. It
 * lives beside the router so the header, the palette and any page can open it
 * and a failed write keeps every value.
 */
export function QuickCaptureProvider({
  spaceId,
  children,
}: {
  spaceId: string | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [requestedType, setRequestedType] = useState<string | undefined>(undefined);
  const space = useSpace(spaceId);
  const available = Boolean(spaceId && space.data && space.data.role !== "viewer");

  // Leaving the space invalidates the target type; a sheet never survives into
  // another space's schema.
  useEffect(() => {
    setOpen(false);
  }, [spaceId]);

  const api = useMemo<QuickCaptureApi>(
    () => ({
      open: (typeKey?: string) => {
        if (!spaceId) {
          return;
        }
        setRequestedType(typeKey);
        setOpen(true);
      },
      close: () => setOpen(false),
      isOpen: open,
      available,
    }),
    [spaceId, open, available],
  );

  return (
    <QuickCaptureContext value={api}>
      {children}
      <QuickCaptureDialog
        open={open}
        onOpenChange={setOpen}
        spaceId={spaceId}
        requestedType={requestedType}
      />
    </QuickCaptureContext>
  );
}

export function useQuickCapture(): QuickCaptureApi {
  const api = use(QuickCaptureContext);
  if (!api) {
    throw new Error("useQuickCapture needs a QuickCaptureProvider above it");
  }
  return api;
}

interface QuickCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string | undefined;
  requestedType: string | undefined;
}

type SubmitIntent = "stay" | "open";

function QuickCaptureDialog({
  open,
  onOpenChange,
  spaceId,
  requestedType,
}: QuickCaptureDialogProps) {
  const me = useMe();
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateObject(spaceId ?? "");
  const titleRef = useRef<HTMLInputElement>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  /** Bumped after Create stays open; focus returns once the button re-enables. */
  const [refocus, setRefocus] = useState(0);
  /** Remounts every property editor when the draft is cleared, so no stale text survives. */
  const [epoch, setEpoch] = useState(0);
  /** The field a refusal named; focused once the pending buttons re-enable. */
  const [problemField, setProblemField] = useState<string | null>(null);

  const typeList = types.data ?? [];
  const type = useType(spaceId, selected ?? undefined);
  const properties = useProperties(spaceId);
  const { required, optional } = captureFields(type.data, properties.data ?? []);
  const missing = required.filter((property) => isBlank(values[property.key]));
  const ready =
    selected !== null &&
    !type.isPending &&
    !properties.isPending &&
    type.data !== undefined &&
    properties.data !== undefined;

  // Opening starts a fresh draft and resolves the preferred type: the opener's
  // hint, else this user's last capture here, else the first type.
  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle("");
    setIcon("");
    setValues({});
    setInvalid(new Set());
    setError(null);
    setRefocus(0);
    setEpoch((current) => current + 1);
    setProblemField(null);
    setSelected(null);
  }, [open, spaceId]);

  useEffect(() => {
    if (!open || typeList.length === 0) {
      return;
    }
    const userId = me.data?.id;
    const stored = userId
      ? readCaptureType(window.localStorage, captureTypeKey(userId, spaceId ?? ""))
      : null;
    const exists = (key: string | null | undefined): key is string =>
      typeof key === "string" && typeList.some((entry) => entry.key === key);
    setSelected((current) => {
      if (exists(current)) {
        return current;
      }
      if (exists(requestedType)) {
        return requestedType;
      }
      if (exists(stored)) {
        return stored;
      }
      return typeList[0]?.key ?? null;
    });
  }, [open, typeList, requestedType, me.data?.id, spaceId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    // The dialog's own focus trap runs first; the title owns focus after it.
    const frame = window.requestAnimationFrame(() => titleRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  // A created-and-kept-open sheet refocuses once the pending button is enabled
  // again; focusing a still-disabled input would drop focus to the body.
  useEffect(() => {
    if (open && !create.isPending && refocus > 0) {
      titleRef.current?.focus();
    }
  }, [open, create.isPending, refocus]);

  useEffect(() => {
    if (!open || create.isPending || problemField === null) {
      return;
    }
    focusProblem(problemField);
  }, [open, create.isPending, problemField]);

  function chooseType(next: string) {
    setSelected(next === "" ? null : next);
    setValues({});
    setInvalid(new Set());
    setEpoch((current) => current + 1);
    setError(null);
  }

  function focusProblem(field: string | undefined) {
    if (!field || field === "title") {
      titleRef.current?.focus();
      return;
    }
    document
      .getElementById(`capture-field-${field}`)
      ?.querySelector<HTMLElement>("input, textarea, select, button")
      ?.focus();
  }

  function submit(intent: SubmitIntent) {
    if (!spaceId || !selected || create.isPending) {
      return;
    }
    const trimmed = title.trim();
    if (trimmed === "" || trimmed.length > 200 || missing.length > 0 || invalid.size > 0) {
      return;
    }
    const payload: Record<string, unknown> = {};
    for (const property of [...required, ...optional]) {
      const value = values[property.key];
      if (!isBlank(value)) {
        payload[property.key] = value;
      }
    }
    setError(null);
    setProblemField(null);
    create.mutate(
      {
        type: selected,
        title: trimmed,
        ...(icon.trim() === "" ? {} : { icon: icon.trim() }),
        ...(Object.keys(payload).length > 0 ? { properties: payload } : {}),
      },
      {
        onSuccess: (object) => {
          const userId = me.data?.id;
          if (userId) {
            writeCaptureType(
              window.localStorage,
              captureTypeKey(userId, spaceId),
              selected,
            );
          }
          if (intent === "open") {
            onOpenChange(false);
            navigate(`/s/${spaceId}/o/${object.id}`);
            return;
          }
          setTitle("");
          setIcon("");
          setValues({});
          setInvalid(new Set());
          setEpoch((current) => current + 1);
          setProblemField(null);
          setRefocus((current) => current + 1);
          toast.showToast("Record created", "plain", {
            label: "Open",
            onAction: () => {
              onOpenChange(false);
              navigate(`/s/${spaceId}/o/${object.id}`);
            },
          });
        },
        onError: (failure) => {
          setError(readError(failure));
          setProblemField(readApiProblems(failure)[0]?.field ?? "title");
        },
      },
    );
  }

  const pending = create.isPending;
  const disabled =
    pending ||
    !ready ||
    title.trim() === "" ||
    missing.length > 0 ||
    invalid.size > 0;
  const { handedness } = useHandedness();
  const captureTitle = (
    <div>
      <Dialog.Title className="text-[17px] font-medium">Quick capture</Dialog.Title>
      <Dialog.Description className="mt-1 text-[13px] text-muted">
        Required fields first, then every editable field in a compact grid.
      </Dialog.Description>
    </div>
  );
  const captureClose = (
    <Dialog.Close
      key="close"
      aria-label="Close quick capture"
      className={cn(
        "inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        handedness === "left" ? "-ml-1" : "-mr-1",
      )}
    >
      <X aria-hidden size={15} />
    </Dialog.Close>
  );
  const noTypes = types.data !== undefined && typeList.length === 0;
  const canTeachSchema = space.data ? space.data.role !== "viewer" : false;
  const mod = isApplePlatform() ? "⌘" : "Ctrl";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-ground/85" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center sm:items-start sm:px-4 sm:pt-[12vh]">
          <Dialog.Popup
            className="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-sheet border border-line bg-surface sm:w-[34rem] sm:rounded-sheet"
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) {
                return;
              }
              event.preventDefault();
              submit(event.shiftKey ? "open" : "stay");
            }}
          >
            <div
              className={cn(
                "flex items-baseline gap-4 border-b rule px-4 py-3",
                handedness === "left" ? "justify-start" : "justify-between",
              )}
            >
              {handedness === "left" ? (
                <>
                  {captureClose}
                  {captureTitle}
                </>
              ) : (
                <>
                  {captureTitle}
                  {captureClose}
                </>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {types.isPending ? (
                <p className="text-[13px] text-muted">Reading types…</p>
              ) : types.isError ? (
                <div className="grid gap-2">
                  <p role="alert" className="text-[13px] text-danger">
                    {readError(types.error)}
                  </p>
                  <Button
                    variant="ghost"
                    className="w-fit"
                    onClick={() => void types.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : noTypes ? (
                <div className="grid gap-2">
                  <p className="text-[15px]">This space has no types yet.</p>
                  {canTeachSchema ? (
                    <p className="text-[13px] text-muted">
                      A type is the table a record belongs to.{" "}
                      <Link
                        className="text-accent underline decoration-accent/50 underline-offset-2"
                        to={`/s/${spaceId}/schema`}
                        onClick={() => onOpenChange(false)}
                      >
                        Create the first type
                      </Link>{" "}
                      to start capturing records.
                    </p>
                  ) : (
                    <p className="text-[13px] text-muted">
                      Ask an owner to create a type before capturing records.
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid gap-4">
                  <div className="grid gap-1.5">
                    <label htmlFor="capture-type" className="label">
                      Type
                    </label>
                    <select
                      id="capture-type"
                      className={control}
                      value={selected ?? ""}
                      disabled={pending}
                      onChange={(event) => chooseType(event.target.value)}
                    >
                      {selected === null ? <option value="">Choose a type</option> : null}
                      {typeList.map((entry) => (
                        <option key={entry.key} value={entry.key}>
                          {entry.name} · {entry.key}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-1.5">
                    <label htmlFor="capture-title" className="label">
                      Title
                    </label>
                    <input
                      id="capture-title"
                      ref={titleRef}
                      className={control}
                      maxLength={200}
                      required
                      autoComplete="off"
                      value={title}
                      disabled={pending}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </div>

                  <IconPicker
                    label="Icon"
                    value={icon}
                    onChange={setIcon}
                    disabled={pending}
                    hint="Optional — shows beside the record’s title."
                  />

                  {selected !== null && type.isPending ? (
                    <p className="text-[13px] text-muted">Reading the type…</p>
                  ) : null}

                  {selected !== null && properties.isError ? (
                    <div className="grid gap-2">
                      <p role="alert" className="text-[13px] text-danger">
                        {readError(properties.error)}
                      </p>
                      <Button
                        variant="ghost"
                        className="w-fit"
                        onClick={() => void properties.refetch()}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : null}

                  {ready && required.length === 0 ? (
                    <p className="text-[13px] text-muted">
                      Only a title is required for this type.
                    </p>
                  ) : null}

                  {ready ? (
                    <>
                      {required.map((property) => (
                        <div
                          key={`${property.key}:${epoch}`}
                          id={`capture-field-${property.key}`}
                          className="grid gap-1.5"
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="label">{property.name}</span>
                            <span className="font-mono text-[10px] text-faint">
                              {property.key} · required
                            </span>
                          </div>
                          <PropertyField
                            spaceId={spaceId ?? ""}
                            property={property}
                            value={values[property.key] ?? null}
                            label={valueLabel(property.format, values[property.key], property)}
                            timeZone={space.data?.timezone}
                            canEdit
                            onChange={(value) =>
                              setValues((current) => ({
                                ...current,
                                [property.key]: value,
                              }))
                            }
                            onInvalid={(isInvalid) =>
                              setInvalid((current) => {
                                const next = new Set(current);
                                if (isInvalid) {
                                  next.add(property.key);
                                } else {
                                  next.delete(property.key);
                                }
                                return next;
                              })
                            }
                          />
                        </div>
                      ))}
                      {optional.length > 0 ? (
                        <section
                          aria-labelledby="capture-other-fields"
                          className="grid gap-3 border-t rule pt-4"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <h3 id="capture-other-fields" className="label">
                              Other fields
                            </h3>
                            <span className="label tnum">{optional.length}</span>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            {optional.map((property) => (
                              <div
                                key={`${property.key}:${epoch}`}
                                id={`capture-field-${property.key}`}
                                className="grid content-start gap-1"
                              >
                                <span className="flex items-baseline justify-between gap-2">
                                  <span
                                    className="label min-w-0 truncate"
                                    title={property.name}
                                  >
                                    {property.name}
                                  </span>
                                  <span className="shrink-0 font-mono text-[10px] text-faint">
                                    {property.key}
                                  </span>
                                </span>
                                <PropertyField
                                  spaceId={spaceId ?? ""}
                                  property={property}
                                  value={values[property.key] ?? null}
                                  label={valueLabel(
                                    property.format,
                                    values[property.key],
                                    property,
                                  )}
                                  timeZone={space.data?.timezone}
                                  canEdit
                                  onChange={(value) =>
                                    setValues((current) => ({
                                      ...current,
                                      [property.key]: value,
                                    }))
                                  }
                                  onInvalid={(isInvalid) =>
                                    setInvalid((current) => {
                                      const next = new Set(current);
                                      if (isInvalid) {
                                        next.add(property.key);
                                      } else {
                                        next.delete(property.key);
                                      }
                                      return next;
                                    })
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        </section>
                      ) : null}
                    </>
                  ) : null}
                </div>
              )}
            </div>

            <div className="grid gap-2 border-t rule px-4 py-3">
              {error ? (
                <p role="alert" className="text-[13px] text-danger">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-[11px] text-faint">
                  {mod}+Enter create · {mod}+Shift+Enter open
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    className="min-h-9 px-3 text-[13px]"
                    disabled={disabled || noTypes}
                    onClick={() => submit("open")}
                  >
                    Create and open
                  </Button>
                  <Button
                    className="min-h-9 px-3 text-[13px]"
                    disabled={disabled || noTypes}
                    onClick={() => submit("stay")}
                  >
                    {pending ? "Creating…" : "Create"}
                  </Button>
                </div>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
