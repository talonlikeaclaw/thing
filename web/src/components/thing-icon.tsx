import { Box } from "lucide-react";

import { cn } from "@/lib/cn";

const BOX = {
  sm: "size-4 text-[13px]",
  md: "size-5 text-[16px]",
  lg: "size-7 text-[24px]",
} as const;

const GLYPH = { sm: 11, md: 13, lg: 19 } as const;

const LETTER = {
  sm: "text-[13px]",
  md: "text-[16px]",
  lg: "text-[24px]",
} as const;

interface ThingIconProps {
  icon?: string | null;
  /** The thing's name, used for a word fallback when it has no icon. */
  name?: string | null;
  size?: keyof typeof BOX;
  className?: string;
}

/**
 * A fixed slot for a user-authored emoji icon. A missing one shows the thing's
 * first letter in the display face, so two iconless types never render the
 * same anonymous box; without a name the slot keeps the column aligned.
 */
export function ThingIcon({ icon, name, size = "sm", className }: ThingIconProps) {
  const glyph = icon?.trim();
  const letter = glyph ? "" : (name?.trim().charAt(0).toUpperCase() ?? "");
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center leading-none",
        BOX[size],
        className,
      )}
    >
      {glyph ? (
        glyph
      ) : letter ? (
        <span className={cn("display font-medium text-muted", LETTER[size])}>{letter}</span>
      ) : (
        <Box size={GLYPH[size]} strokeWidth={1.5} className="text-faint" />
      )}
    </span>
  );
}
