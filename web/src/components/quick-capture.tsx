import { Dialog } from "@base-ui/react/dialog";
import { ChevronDown, X } from "lucide-react";
import {
  createContext,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
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
import { ThumbRow, useHandedness } from "@/components/handedness";
import { IconPicker } from "@/components/icon-picker";
import { PropertyField } from "@/components/property-field";
import { Button } from "@/components/ui/controls";
import {
  focusSheetField,
  SheetPopup,
  sheetReturnFocus,
  SheetViewport,
} from "@/components/ui/sheet";
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
  currentType,
  children,
}: {
  spaceId: string | undefined;
  /** The type the current route belongs to, used when the opener gives no hint. */
  currentType?: string | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [requestedType, setRequestedType] = useState<string | undefined>(undefined);
  /**
   * The title field. The sheet stays mounted, so the opener can focus it inside
   * its own tap — the only moment iOS Safari raises the keyboard.
   */
  const titleRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
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
        // An explicit hint (the type page's New record) wins; otherwise the
        // route's own type is the draft, so `C` on Plants captures a Plant.
        setRequestedType(typeKey ?? currentType);
        returnFocusRef.current = sheetReturnFocus();
        setOpen(true);
        focusSheetField(titleRef.current);
      },
      close: () => setOpen(false),
      isOpen: open,
      available,
    }),
    [spaceId, currentType, open, available],
  );

  return (
    <QuickCaptureContext value={api}>
      {children}
      <QuickCaptureDialog
        open={open}
        onOpenChange={setOpen}
        titleRef={titleRef}
        returnFocusRef={returnFocusRef}
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
  titleRef: RefObject<HTMLInputElement | null>;
  /** Where focus goes when the sheet closes; see `sheetReturnFocus`. */
  returnFocusRef: RefObject<HTMLElement | null>;
  spaceId: string | undefined;
  requestedType: string | undefined;
}

type SubmitIntent = "stay" | "open";

function QuickCaptureDialog({
  open,
  onOpenChange,
  titleRef,
  returnFocusRef,
  spaceId,
  requestedType,
}: QuickCaptureDialogProps) {
  const me = useMe();
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateObject(spaceId ?? "");

  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  /** Bumped after Create stays open; focus returns once the button re-enables. */
  const [refocus, setRefocus] = useState(0);
  /** The optional fields are a disclosure: a phone capture is the title and the required rows. */
  const [showOptional, setShowOptional] = useState(false);
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
    setShowOptional(false);
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

  // The title owns focus from the commit the opening tap triggered, the last
  // moment iOS still counts as the user's gesture. When the type list is still
  // loading the field does not exist yet, so the same focus is re-attempted on
  // the commit that mounts it; either way it happens once per open.
  const focusedOnOpen = useRef(false);
  useLayoutEffect(() => {
    if (!open) {
      focusedOnOpen.current = false;
      return;
    }
    if (focusedOnOpen.current || titleRef.current === null) {
      return;
    }
    titleRef.current.focus({ preventScroll: true });
    focusedOnOpen.current = true;
  }, [open, types.isPending, typeList.length]);

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
    // Values survive a switch: a property both types carry keeps its entry, and
    // `submit` writes only the selected type's keys. A switch back restores it.
    setInvalid(new Set());
    setEpoch((current) => current + 1);
    setError(null);
    setProblemField(null);
    setShowOptional(false);
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
  // An optional field that went invalid while the disclosure was open must not
  // become invisible: the Create guard needs it on screen.
  const optionalInvalid = optional.some((property) => invalid.has(property.key));
  const otherOpen = showOptional || optionalInvalid;
  const captureTitle = (
    <div>
      <Dialog.Title className="text-[17px] font-medium">Quick capture</Dialog.Title>
      <Dialog.Description className="mt-1 text-[13px] text-muted max-sm:sr-only">
        Required fields first; the type's other fields sit behind Other fields.
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
      {/* Kept mounted: the title exists before the tap so that tap can focus it
          and raise the keyboard, and sits off-canvas while closed. */}
      <Dialog.Portal keepMounted>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-ground/85" />
        <SheetViewport>
          <SheetPopup
            className="sm:w-[34rem]"
            inert={!open}
            initialFocus={() => titleRef.current ?? true}
            finalFocus={() => returnFocusRef.current ?? false}
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
                "flex items-baseline gap-4 border-b rule px-4 py-1.5 sm:py-3",
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

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2.5 sm:py-4">
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
                <div className="grid gap-2.5 sm:gap-4">
                  {/* The title is what the keyboard is for, so it leads and
                      shares its row with the icon instead of giving the
                      picker a labelled row of its own. */}
                  <div className="flex min-w-0 items-end gap-2">
                    <IconPicker
                      label="Icon"
                      value={icon}
                      onChange={setIcon}
                      disabled={pending}
                      variant="glyph"
                    />
                    <div className="grid min-w-0 flex-1 gap-1.5">
                      <label htmlFor="capture-title" className="label max-sm:sr-only">
                        Title
                      </label>
                      <input
                        id="capture-title"
                        ref={titleRef}
                        className={control}
                        maxLength={200}
                        required
                        autoComplete="off"
                        placeholder="Title"
                        value={title}
                        disabled={pending}
                        onChange={(event) => setTitle(event.target.value)}
                      />
                    </div>
                  </div>

                  {/* A keyed row on a phone — the label beside the select
                      instead of above it — so the fields below get the height
                      the keyboard leaves. Stacked from `sm` up. */}
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 sm:block">
                    <label htmlFor="capture-type" className="label">
                      Type
                    </label>
                    <select
                      id="capture-type"
                      className={cn(control, "sm:mt-1.5")}
                      value={selected ?? ""}
                      disabled={pending}
                      onChange={(event) => chooseType(event.target.value)}
                    >
                      {selected === null ? <option value="">Choose a type</option> : null}
                      {typeList.map((entry) => (
                        <option key={entry.key} value={entry.key}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  </div>

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
                            <span className="font-mono text-[11px] text-faint">required</span>
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
                          className="border-t rule pt-4"
                        >
                          <button
                            type="button"
                            aria-expanded={otherOpen}
                            aria-controls="capture-other-fields-body"
                            className="flex min-h-9 w-full items-center justify-between gap-2 rounded-[3px] text-left transition-colors hover:text-ink pointer-coarse:min-h-11"
                            onClick={() => setShowOptional((current) => !current)}
                          >
                            <span id="capture-other-fields" className="label">
                              Other fields
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="label tnum">{optional.length}</span>
                              <ChevronDown
                                aria-hidden
                                size={14}
                                className={cn(
                                  "shrink-0 text-faint transition-transform",
                                  otherOpen && "rotate-180",
                                )}
                              />
                            </span>
                          </button>
                          {otherOpen ? (
                            <div
                              id="capture-other-fields-body"
                              className="mt-3 grid gap-3 sm:grid-cols-2"
                            >
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
                                  <span className="shrink-0 font-mono text-[11px] text-faint">
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
                          ) : null}
                        </section>
                      ) : null}
                    </>
                  ) : null}
                </div>
              )}
            </div>

            <div className="sheet-footer grid gap-2 border-t rule px-4 pt-2 sm:pt-3">
              {error ? (
                <p role="alert" className="text-[13px] text-danger">
                  {error}
                </p>
              ) : null}
              <ThumbRow className="flex-wrap items-center gap-3">
                <p className="hidden font-mono text-[11px] text-faint sm:block pointer-coarse:hidden">
                  {mod}+Enter create · {mod}+Shift+Enter open
                </p>
                <ThumbRow className="flex-wrap items-center gap-2">
                  <Button
                    variant="ghost"
                    className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
                    disabled={disabled || noTypes}
                    onClick={() => submit("open")}
                  >
                    Create and open
                  </Button>
                  <Button
                    className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
                    disabled={disabled || noTypes}
                    onClick={() => submit("stay")}
                  >
                    {pending ? "Creating…" : "Create"}
                  </Button>
                </ThumbRow>
              </ThumbRow>
            </div>
          </SheetPopup>
        </SheetViewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
