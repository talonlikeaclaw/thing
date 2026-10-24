import { Box } from "lucide-react";

import { cn } from "@/lib/cn";

const BOX = {
  sm: "size-4 text-[13px]",
  md: "size-5 text-[16px]",
  lg: "size-7 text-[24px]",
} as const;

const GLYPH = { sm: 11, md: 13, lg: 19 } as const;

interface ThingIconProps {
  icon?: string | null;
  size?: keyof typeof BOX;
  className?: string;
}

/** A fixed slot for a user-authored emoji icon; a missing one keeps the column aligned. */
export function ThingIcon({ icon, size = "sm", className }: ThingIconProps) {
  const glyph = icon?.trim();
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center leading-none",
        BOX[size],
        className,
      )}
    >
      {glyph ? glyph : <Box size={GLYPH[size]} strokeWidth={1.5} className="text-faint" />}
    </span>
  );
}
