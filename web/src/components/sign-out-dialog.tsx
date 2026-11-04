import { Dialog } from "@base-ui/react/dialog";
import { useState, type RefObject } from "react";
import { useNavigate } from "react-router";

import { useLogout } from "@/api/queries";
import { ThumbRow } from "@/components/handedness";
import { Button, FormError } from "@/components/ui/controls";
import { SheetPopup, SheetTitle, SheetViewport } from "@/components/ui/sheet";
import { readError } from "@/lib/display";

/**
 * The confirmation behind the account menu's **Sign out**. The menu item owns
 * the trigger, so the dialog is controlled: closing without signing out
 * returns focus to the menu's button through `finalFocus` rather than to an
 * item the closed menu has already unmounted.
 *
 * An unsaved draft lives only in this browser and a sign out discards it, so a
 * failure keeps the dialog open with the error and Retry beside the action.
 */
export function SignOutDialog({
  open,
  onOpenChange,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus lands when the dialog closes without signing out. */
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const logout = useLogout();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  function changeOpen(next: boolean) {
    if (!next) {
      setError(null);
    }
    onOpenChange(next);
  }

  function signOut() {
    setError(null);
    logout.mutate(undefined, {
      onSuccess: () => {
        changeOpen(false);
        navigate("/login");
      },
      onError: (failure) => setError(readError(failure)),
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 scrim" />
        <SheetViewport placement="center">
          <SheetPopup
            finalFocus={finalFocus}
            className="max-w-[26rem] rounded-sheet px-4 pt-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            <SheetTitle>Sign out?</SheetTitle>
            <Dialog.Description className="mt-1 text-[length:var(--text-small)] leading-[var(--text-small--line-height)] text-muted">
              Any unsaved draft in this browser will be lost.
            </Dialog.Description>
            {error ? (
              <div className="mt-3">
                <FormError message={error} />
              </div>
            ) : null}
            <ThumbRow className="mt-4 flex-wrap items-center gap-2 border-t rule pt-3">
              <Button variant="ghost" disabled={logout.isPending} onClick={() => changeOpen(false)}>
                Cancel
              </Button>
              <Button disabled={logout.isPending} onClick={signOut}>
                {logout.isPending ? "Signing out…" : error ? "Retry" : "Sign out"}
              </Button>
            </ThumbRow>
          </SheetPopup>
        </SheetViewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
