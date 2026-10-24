import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBlocker } from "react-router";

import { Button } from "@/components/ui/controls";

/**
 * A navigation guard for unsaved drafts.
 *
 * React Router's blocker only sees in-app navigation; `beforeunload` covers a
 * tab close. The dialog is rendered by the page that owns the draft, so one
 * hook serves the record panel and every schema or settings form.
 */
export function useDirtyGuard(
  dirty: boolean,
  save: () => Promise<boolean>,
): React.ReactNode {
  const blocker = useBlocker(dirty);
  const saveRef = useRef(save);
  saveRef.current = save;
  const [saving, setSaving] = useState(false);
  const saveButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (blocker.state === "blocked") {
      saveButton.current?.focus();
    } else {
      setSaving(false);
    }
  }, [blocker.state]);

  if (blocker.state !== "blocked") {
    return null;
  }

  const { proceed, reset } = blocker;

  async function saveAndLeave() {
    setSaving(true);
    const ok = await saveRef.current();
    setSaving(false);
    if (ok) {
      proceed();
    } else {
      // The save failed; the page keeps the draft and the dialog closes so the
      // error next to the form is reachable.
      reset();
    }
  }

  // A `.settle` ancestor animates a transform, which would make `fixed`
  // resolve against that element instead of the viewport. The portal keeps the
  // dialog centred on the screen from every page.
  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ground/70 p-4 backdrop-blur-[1px]"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          reset();
        }
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dirty-guard-title"
        aria-describedby="dirty-guard-body"
        className="w-full max-w-[26rem] border border-line-strong bg-surface p-4"
      >
        <h2 id="dirty-guard-title" className="text-[16px] font-medium">
          Unsaved changes
        </h2>
        <p id="dirty-guard-body" className="mt-1 text-[13px] text-muted">
          Leaving this page discards the changes you have not saved yet.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            ref={saveButton}
            type="button"
            className="min-h-9 px-3 text-[13px]"
            disabled={saving}
            onClick={() => void saveAndLeave()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-9 px-3 text-[13px]"
            disabled={saving}
            onClick={() => blocker.proceed()}
          >
            Discard
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-9 px-3 text-[13px]"
            disabled={saving}
            onClick={() => blocker.reset()}
          >
            Stay
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
