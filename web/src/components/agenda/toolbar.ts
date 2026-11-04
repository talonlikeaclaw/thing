/**
 * The Schedule's controls are separate pills of one size: the view switch, the
 * range switch and the filter each own a `AGENDA_TOOLBAR` frame, so their
 * outer height and their padding are identical at every pointer size without
 * one control sitting inside another's border.
 */
export const AGENDA_TOOLBAR =
  "flex min-w-0 items-center gap-1 rounded-full border border-line bg-surface/70 p-1";

/** One segment inside a frame; the frame supplies the height. */
export const AGENDA_SEGMENT =
  "label inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-faint transition-colors hover:text-ink aria-pressed:bg-accent-wash aria-pressed:text-accent-on-wash pointer-coarse:min-h-11";
