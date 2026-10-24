import { type FormEvent, useState } from "react";

import { useCreateType } from "@/api/queries";
import type { TypeSummary } from "@/api/types";
import { IconPicker } from "@/components/icon-picker";
import { Button, FormError, TextField } from "@/components/ui/controls";
import { readError } from "@/lib/display";

interface TypeListProps {
  spaceId: string;
  types: TypeSummary[];
  selectedKey: string | undefined;
  canEdit: boolean;
  onSelect: (key: string) => void;
  onCreated: (key: string) => void;
}

export function TypeList({
  spaceId,
  types,
  selectedKey,
  canEdit,
  onSelect,
  onCreated,
}: TypeListProps) {
  const create = useCreateType(spaceId);
  const [showCreate, setShowCreate] = useState(false);
  const [schedule, setSchedule] = useState(false);
  const [icon, setIcon] = useState("");
  const [createdKey, setCreatedKey] = useState("");

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const plural = String(data.get("name_plural") ?? "").trim();
    const description = String(data.get("description") ?? "").trim();
    create.mutate(
      {
        name,
        ...(plural ? { name_plural: plural } : {}),
        ...(icon.trim() ? { icon: icon.trim() } : {}),
        ...(description ? { description } : {}),
        ...(schedule ? { schedule: true } : {}),
      },
      {
        onSuccess: (created) => {
          form.reset();
          setIcon("");
          setSchedule(false);
          setShowCreate(false);
          setCreatedKey(created.key);
          onCreated(created.key);
        },
      },
    );
  }

  return (
    <section aria-labelledby="schema-types">
      <div className="flex items-baseline justify-between border-b rule pb-2">
        <h2 id="schema-types" className="text-[17px] font-medium">
          Types
        </h2>
        <span className="label tnum">{types.length}</span>
      </div>

      {createdKey ? (
        <p role="status" className="border-b rule py-2 text-[12px] text-muted">
          Created with key <span className="font-mono text-ink">{createdKey}</span>. The display
          name can change; the key cannot.
        </p>
      ) : null}

      {types.length === 0 ? (
        <p className="border-b rule py-4 text-[13px] text-muted">
          No types yet. A type is a table. Its properties are columns; its records are rows.
        </p>
      ) : (
        <ul>
          {types.map((type) => (
            <li key={type.key} className="border-b rule">
              <button
                type="button"
                aria-current={type.key === selectedKey ? "true" : undefined}
                className="flex w-full items-baseline justify-between gap-3 py-2.5 text-left transition-colors hover:text-accent aria-[current=true]:text-accent pointer-coarse:min-h-11"
                onClick={() => onSelect(type.key)}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  {type.icon ? (
                    <span aria-hidden className="text-[15px] leading-none">
                      {type.icon}
                    </span>
                  ) : null}
                  <span className="truncate text-[15px]">{type.name}</span>
                  <span className="font-mono text-[11px] text-faint">{type.key}</span>
                  {type.schedule ? (
                    <span className="label shrink-0 text-accent">scheduled</span>
                  ) : null}
                </span>
                <span className="label tnum shrink-0">{type.object_count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="mt-3">
          {showCreate ? (
            <form className="grid gap-3" onSubmit={onCreate}>
              <p className="border-l border-line-interactive pl-3 text-[12px] text-muted">
                The key is derived from the name, permanent, and used in file paths and CSV
                headers.
              </p>
              <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                <IconPicker label="Icon" value={icon} onChange={setIcon} />
                <TextField label="Name" name="name" required maxLength={200} autoFocus />
              </div>
              <TextField
                label="Plural"
                name="name_plural"
                maxLength={200}
                hint="Defaults to the name plus s."
              />
              <TextField label="Description" name="description" maxLength={500} />
              <label className="flex min-h-10 items-center gap-2 text-[14px] pointer-coarse:min-h-11">
                <input
                  type="checkbox"
                  checked={schedule}
                  onChange={(event) => setSchedule(event.target.checked)}
                />
                Schedule — due dates, repeats and Complete
              </label>
              <FormError message={create.error ? readError(create.error) : null} />
              <div className="flex gap-2">
                <Button type="submit" disabled={create.isPending} className="min-h-9 px-3 text-[13px]">
                  {create.isPending ? "Creating…" : "Create type"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-9 px-3 text-[13px]"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="min-h-9 px-3 text-[13px]"
              onClick={() => setShowCreate(true)}
            >
              New type
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
