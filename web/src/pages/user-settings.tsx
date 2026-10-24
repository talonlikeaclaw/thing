import { useEffect, useState } from "react";

import { useMe } from "@/api/queries";
import { AccentPicker } from "@/components/accent-picker";
import { useHandedness } from "@/components/handedness";
import { cn } from "@/lib/cn";
import {
  DEFAULT_ACCENT,
  applyAccent,
  readDefaultAccent,
  writeDefaultAccent,
  type AccentId,
} from "@/lib/accent";
import { useRouteMeta } from "@/lib/route";

// Fixed spatial order: the left option sits on the left edge, the right
// option on the right edge, in both modes. The row never reorders when the
// choice changes, so the control does not move under the pointer.
const HANDEDNESS_OPTIONS = [
  { value: "left", label: "Left-handed", align: "justify-start" },
  { value: "right", label: "Right-handed", align: "justify-end" },
] as const;

/**
 * `/settings` — preferences that belong to the person, not to one space.
 *
 * Both values are browser-local: handedness describes the device in the
 * user's hand, and the highlight is a starting colour a space may override.
 */
export function UserSettingsPage() {
  const me = useMe();
  const { handedness, setHandedness } = useHandedness();
  const userId = me.data?.id;
  const [accent, setAccent] = useState<AccentId>(DEFAULT_ACCENT);

  useEffect(() => {
    if (userId) {
      setAccent(readDefaultAccent(window.localStorage, userId));
    }
  }, [userId]);

  useRouteMeta("Account settings");

  /** Immediate apply and best-effort persist; a refusal never shows an error. */
  const chooseAccent = (next: AccentId) => {
    setAccent(next);
    if (!userId) {
      return;
    }
    writeDefaultAccent(window.localStorage, userId, next);
    applyAccent(document.documentElement, next);
  };

  const user = me.data;

  return (
    <div className="settle max-w-[52ch]">
      <h1 className="text-[26px] font-medium tracking-[-0.02em]">Account settings</h1>
      <p className="mt-2 text-[13px] text-muted">
        These preferences follow this browser and account. They never reach a space.
      </p>

      <section aria-labelledby="account-identity" className="mt-10">
        <div className="flex items-baseline justify-between border-b rule pb-2">
          <h2 id="account-identity" className="text-[17px] font-medium">
            Account
          </h2>
        </div>
        {user ? (
          <div className="mt-4 grid gap-2">
            <p className="text-[17px]">{user.name}</p>
            <p className="font-mono text-[12px] text-muted">{user.email}</p>
            <p className="text-[13px] text-muted">
              Sign-in details are managed by the server. Appearance below is stored in this
              browser only.
            </p>
          </div>
        ) : (
          <p className="mt-4 text-[13px] text-muted">Reading your account…</p>
        )}
      </section>

      <section aria-labelledby="account-appearance" className="mt-10">
        <div className="flex items-baseline justify-between border-b rule pb-2">
          <h2 id="account-appearance" className="text-[17px] font-medium">
            Appearance
          </h2>
        </div>
        <p className="mt-4 text-[13px] text-muted">
          Default highlight applies to new spaces and to spaces without their own choice. A space
          can override it in that space's settings.
        </p>
        <AccentPicker
          value={accent}
          onChange={chooseAccent}
          labelledBy="account-appearance"
        />

        <fieldset className="mt-6 border-t rule pt-4">
          <legend className="label">Handedness</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {HANDEDNESS_OPTIONS.map((option) => {
              const checked = handedness === option.value;
              return (
                <label
                  key={option.value}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-2 rounded-field border px-2.5 text-[13px] transition-colors sm:px-3 sm:text-[14px]",
                    option.align,
                    checked
                      ? "border-accent bg-raised"
                      : "border-line hover:border-line-strong",
                  )}
                >
                  <input
                    type="radio"
                    name="handedness"
                    value={option.value}
                    checked={checked}
                    onChange={() => setHandedness(option.value)}
                    className="h-4 w-4 shrink-0 accent-accent"
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
          <p className="mt-2 text-[13px] text-muted">
            Moves the bottom bar, action rows, menus and toasts to your thumb. Saved in this
            browser only.
          </p>
        </fieldset>
      </section>
    </div>
  );
}
