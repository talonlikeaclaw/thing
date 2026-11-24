import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * The one month-or-week control row both calendar shapes share: the range's
 * name leading, then previous, Today and next as one cluster. It labels the
 * arrows for the shape it moves, so a week is never announced as a month.
 */
export function CalendarControls({
  label,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  onToday,
}: {
  /** `November 2026` or `23–29 November 2026`. */
  label: string;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-heading font-medium">{label}</h2>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={previousLabel}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
          onClick={onPrevious}
        >
          <ChevronLeft aria-hidden size={15} />
        </button>
        <button
          type="button"
          className="label rounded-[8px] px-2 py-1 text-muted transition-colors hover:bg-raised hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          onClick={onToday}
        >
          Today
        </button>
        <button
          type="button"
          aria-label={nextLabel}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
          onClick={onNext}
        >
          <ChevronRight aria-hidden size={15} />
        </button>
      </div>
    </div>
  );
}
