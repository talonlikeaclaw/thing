import { Children, createContext, use, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { DEFAULT_HANDEDNESS, type Handedness } from "@/lib/handedness";
import { useWideLayout } from "@/lib/media";

interface HandednessApi {
  handedness: Handedness;
  setHandedness: (value: Handedness) => void;
}

/**
 * One reader for the preference: `AppFrame` loads storage, applies the root
 * attribute and hands the value down, so no component parses storage again.
 * The signed-out shell always sees the right-handed default.
 */
const HandednessContext = createContext<HandednessApi>({
  handedness: DEFAULT_HANDEDNESS,
  setHandedness: () => undefined,
});

export function HandednessProvider({
  value,
  children,
}: {
  value: HandednessApi;
  children: ReactNode;
}) {
  return <HandednessContext value={value}>{children}</HandednessContext>;
}

export function useHandedness(): HandednessApi {
  return use(HandednessContext);
}

/**
 * The hand a thumb control answers to. Handedness is a device-in-hand
 * preference: from `lg` the desktop keeps its one reading layout, so every
 * thumb-zone surface and `ThumbRow` asks this instead of the raw choice.
 */
export function useThumbHandedness(): Handedness {
  const { handedness } = useHandedness();
  const wide = useWideLayout();
  return wide ? DEFAULT_HANDEDNESS : handedness;
}

/**
 * A shared action row whose primary child sits at the thumb edge. Call sites
 * keep the canonical right-handed order (secondary and status first, primary
 * last); on a phone in left mode the children are reversed in the DOM so paint,
 * Tab and screen-reader order agree, while the desktop keeps the canonical
 * order. `Children.toArray` keeps each child's key, so React moves rather than
 * remounts it.
 */
export function ThumbRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const handedness = useThumbHandedness();
  const items = Children.toArray(children);
  return (
    <div
      className={cn(
        "flex",
        handedness === "left" ? "justify-start" : "justify-end",
        className,
      )}
      data-thumb-row={handedness}
    >
      {handedness === "left" ? [...items].reverse() : items}
    </div>
  );
}
