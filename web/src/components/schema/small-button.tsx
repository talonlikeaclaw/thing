import type { ReactNode } from "react";

import { Button } from "@/components/ui/controls";

/** A 32px icon control that grows to 44px for a coarse pointer. */
export function SmallButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={label}
      title={label}
      disabled={disabled}
      className="min-h-8 min-w-8 px-1.5 text-[12px] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
