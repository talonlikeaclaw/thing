import { useCompleteObject, useSnoozeObject, useTypeDetails } from "@/api/queries";
import type { AgendaRow } from "@/api/types";
import { useToast } from "@/components/ui/toast";
import { readError } from "@/lib/display";
import { completeLabel } from "@/lib/schedule";

/**
 * The completion and snooze actions a dated surface offers on a scheduled row.
 *
 * One implementation for the Schedule, the Calendar, the day page and the
 * record's day margin, so the type's own verb, the busy row and each toast's
 * Undo are the same wherever the row is shown.
 */
export function useAgendaActions(spaceId: string, typeKeys: string[]) {
  const details = useTypeDetails(spaceId, typeKeys);
  const verbs: Record<string, string> = Object.fromEntries(
    details.details.map((def) => [def.key, completeLabel(def.schedule_labels)]),
  );
  const complete = useCompleteObject(spaceId);
  const snooze = useSnoozeObject(spaceId);
  const toast = useToast();

  function onSnooze(row: AgendaRow, days: number) {
    snooze.mutate(
      { id: row.id, rev: row.rev, days },
      {
        onSuccess: ({ object: saved, dueDateBefore }) => {
          const nextDue = saved.schedule?.due_date;
          toast.showToast(
            nextDue
              ? `Snoozed “${saved.title}” to ${nextDue}.`
              : `“${saved.title}” snoozed.`,
            "plain",
            {
              label: "Undo",
              onAction: () => {
                void snooze
                  .undo(saved, dueDateBefore)
                  .then(() => toast.showToast("Snooze undone."))
                  .catch((error) =>
                    toast.showToast(`Could not undo — ${readError(error)}`, "danger"),
                  );
              },
            },
          );
        },
        onError: (error) => {
          toast.showToast(`Could not snooze — ${readError(error)}`, "danger");
        },
      },
    );
  }

  function onComplete(row: AgendaRow) {
    complete.mutate(
      { id: row.id, rev: row.rev },
      {
        onSuccess: ({ object: saved, previous }) => {
          const nextDue = saved.schedule?.due_date;
          toast.showToast(
            nextDue ? `Next due ${nextDue} for “${saved.title}”.` : `“${saved.title}” marked done.`,
            "plain",
            {
              label: "Undo",
              onAction: () => {
                void complete
                  .undo(saved, previous)
                  .then(() => toast.showToast("Completion undone."))
                  .catch((error) =>
                    toast.showToast(`Could not undo — ${readError(error)}`, "danger"),
                  );
              },
            },
          );
        },
        onError: (error) => {
          toast.showToast(`Could not complete — ${readError(error)}`, "danger");
        },
      },
    );
  }

  // One busy row at a time: the verb and the alarm both disable together.
  const pendingId =
    (complete.isPending ? complete.variables?.id : undefined) ??
    (snooze.isPending ? snooze.variables?.id : undefined) ??
    null;

  return { verbs, pendingId, onComplete, onSnooze };
}
