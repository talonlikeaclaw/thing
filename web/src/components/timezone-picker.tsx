import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown } from "lucide-react";
import { useId, type ReactNode } from "react";

import { fieldFrame } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { defaultSpaceTimezone } from "@/lib/timezone";

interface TimezonePickerProps {
  value: string;
  onValueChange: (value: string) => void;
  zones: string[];
  id?: string;
  disabled?: boolean;
  label?: string;
  /** Omitted when a `FieldRow` supplies the visible label and ties it by `id`. */
  hideLabel?: boolean;
  /** Hide the device-zone action where the value already starts there. */
  showDeviceZone?: boolean;
  hint?: ReactNode;
}

/**
 * A searchable IANA zone field.
 *
 * Every runtime carries several hundred zone names, so the field filters as
 * the reader types instead of scrolling a flat select. The selected value is
 * only written when an item is chosen; a half-typed filter never changes the
 * space's zone. The device's zone is one explicit action away.
 */
export function TimezonePicker({
  value,
  onValueChange,
  zones,
  id,
  disabled,
  label = "Timezone",
  hideLabel = false,
  showDeviceZone = true,
  hint,
}: TimezonePickerProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const device = defaultSpaceTimezone();

  return (
    <div className="grid gap-1.5">
      {hideLabel ? null : (
        <label className="label" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <Combobox.Root
        items={zones}
        value={value}
        onValueChange={(next) => {
          if (typeof next === "string") {
            onValueChange(next);
          }
        }}
        disabled={disabled}
      >
        <div className="relative">
          <Combobox.Input
            id={fieldId}
            aria-label={label}
            aria-describedby={hintId}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
            className={cn(
              fieldFrame,
              "h-[var(--field-fine)] pr-10 pl-3 pointer-coarse:h-[var(--field-coarse)]",
            )}
          />
          <Combobox.Trigger
            aria-label="Open timezone list"
            disabled={disabled}
            className="absolute top-0 right-0 inline-flex h-10 w-10 items-center justify-center text-muted transition-colors hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
          >
            <ChevronDown aria-hidden size={16} />
          </Combobox.Trigger>
        </div>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={4} className="z-50">
            <Combobox.Popup className="glass-strong w-[var(--anchor-width)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-card">
              <Combobox.Empty>
                <p className="px-3 py-3 text-[13px] text-muted">No zone matches that name.</p>
              </Combobox.Empty>
              <Combobox.List className="max-h-64 overflow-auto overscroll-contain p-1">
                {(zone: string) => (
                  <Combobox.Item
                    key={zone}
                    value={zone}
                    className="grid min-h-9 cursor-pointer grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded-[10px] px-2 py-1.5 font-mono text-[12.5px] text-ink select-none data-[highlighted]:bg-accent-wash data-[highlighted]:text-accent-on-wash pointer-coarse:min-h-11 pointer-coarse:text-[14px]"
                  >
                    <Combobox.ItemIndicator className="text-accent">
                      <Check aria-hidden size={13} />
                    </Combobox.ItemIndicator>
                    <span className="col-start-2 truncate">{zone}</span>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      {hint ? (
        <p id={hintId} className="text-[length:var(--text-small)] leading-[var(--text-small--line-height)] text-muted">
          {hint}
        </p>
      ) : null}
      {showDeviceZone && device !== value ? (
        <button
          type="button"
          className="w-fit text-left text-[12px] text-muted underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink disabled:opacity-50 pointer-coarse:min-h-11"
          disabled={disabled}
          onClick={() => onValueChange(device)}
        >
          Use this device's zone: {device}
        </button>
      ) : null}
    </div>
  );
}
