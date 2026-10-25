import { Dialog } from "@base-ui/react/dialog";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { useLogout } from "@/api/queries";
import { ThumbRow } from "@/components/handedness";
import { Button, FormError } from "@/components/ui/controls";
import { readError } from "@/lib/display";

/**
 * The header's Sign out control and its confirmation, in one place: Base UI's
 * trigger keeps `aria-expanded`, Escape and the focus return to the button
 * without this component tracking any of it.
 *
 * An unsaved draft lives only in this browser and a sign out discards it, so a
 * failure keeps the dialog open with the error and Retry beside the action.
 */
export function SignOutDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
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
      <Dialog.Trigger
        render={
          <Button
            variant="ghost"
            aria-label="Sign out"
            aria-haspopup="dialog"
            className="min-h-11 min-w-11 px-2 text-[13px] sm:min-h-8 sm:min-w-0 sm:px-3 pointer-coarse:min-h-11"
          />
        }
      >
        {children}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-ground/85" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <Dialog.Popup className="w-full rounded-sheet border border-line bg-surface px-4 pt-4 pb-3 sm:w-[26rem]">
            <Dialog.Title className="text-[17px] font-medium">Sign out?</Dialog.Title>
            <Dialog.Description className="mt-1 text-[13px] text-muted">
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
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
