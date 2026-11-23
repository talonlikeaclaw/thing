import { useMe, useUpdateMe } from "@/api/queries";
import { AccentPicker } from "@/components/accent-picker";
import { useHandedness } from "@/components/handedness";
import { FormError } from "@/components/ui/controls";
import { PageHeader, SectionRule } from "@/components/ui/page";
import { DEFAULT_ACCENT, isAccentId } from "@/lib/accent";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";
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
 * The profile theme follows the account and can replace a space's shared
 * accent; handedness describes the device in the user's hand, so it stays
 * browser-local. Neither changes what other members see.
 */
export function UserSettingsPage() {
  const me = useMe();
  const update = useUpdateMe();
  const { handedness, setHandedness } = useHandedness();

  useRouteMeta("Account settings");

  const user = me.data;
  const profileAccent = user && isAccentId(user.accent) ? user.accent : DEFAULT_ACCENT;
  const pending = update.isPending;

  return (
    <div className="settle mx-auto max-w-[64ch]">
      <PageHeader
        title="Account settings"
        sentence="The theme follows your account; handedness follows this browser. Neither changes what other members see."
      />

      <section aria-labelledby="account-identity" className="mt-8 rounded-[22px] border border-line bg-surface p-5 sm:p-6">
        <SectionRule id="account-identity" title="Account" />
        {user ? (
          <div className="mt-4 grid gap-2">
            <p className="text-[17px]">{user.name}</p>
            <p className="font-mono text-[12px] text-muted">{user.email}</p>
            <p className="text-[13px] text-muted">
              Sign-in details are managed by the server. The profile theme below is stored with
              your account; handedness stays in this browser.
            </p>
          </div>
        ) : (
          <p className="mt-4 text-[13px] text-muted">Reading your account…</p>
        )}
      </section>

      <section aria-labelledby="account-appearance" className="mt-8 rounded-[22px] border border-line bg-surface p-5 sm:p-6">
        <SectionRule id="account-appearance" title="Appearance" />
        <fieldset className="mt-4">
          <legend id="profile-theme" className="label">
            Profile theme
          </legend>
          <p className="mt-2 text-[13px] text-muted">
            Your room and state colour outside spaces. In a space, the owner&apos;s accent wins
            unless the switch below is on.
          </p>
          <AccentPicker
            value={profileAccent}
            onChange={(accent) => update.mutate({ accent })}
            labelledBy="profile-theme"
            disabled={!user || pending}
          />
          <label className="mt-3 flex min-h-9 items-center gap-2 text-[13px] text-ink pointer-coarse:min-h-11">
            <input
              type="checkbox"
              checked={user?.accent_override ?? false}
              disabled={!user || pending}
              className="h-4 w-4 accent-[var(--color-accent)] pointer-coarse:h-5 pointer-coarse:w-5"
              onChange={(event) => {
                const checked = event.target.checked;
                update.mutate(
                  checked
                    ? { accent_override: true, accent: profileAccent }
                    : { accent_override: false },
                );
              }}
            />
            Use this theme in every space
          </label>
          <p className="mt-2 text-[13px] text-muted">
            Off, a space keeps the accent its owner chose while the spaces list keeps your theme.
            On, your theme replaces it everywhere. Either way, this affects your screens only.
          </p>
          <FormError message={update.error ? readError(update.error) : null} />
        </fieldset>

        <fieldset className="mt-6">
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
            Moves the bottom bar, action rows, menus and toasts to your thumb on a phone.
            Saved in this browser only.
          </p>
        </fieldset>
      </section>
    </div>
  );
}
