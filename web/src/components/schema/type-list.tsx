import { Search } from "lucide-react";
import { type FormEvent, useState } from "react";

import { useCreateType } from "@/api/queries";
import type { TypeSummary } from "@/api/types";
import { ThumbRow } from "@/components/handedness";
import { IconPicker } from "@/components/icon-picker";
import { ThingIcon } from "@/components/thing-icon";
import { Button, FormError, TextField } from "@/components/ui/controls";
import { EmptyState, SectionRule } from "@/components/ui/page";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";
import { foldProperty } from "@/lib/property-search";

interface TypeListProps {
  spaceId: string;
  types: TypeSummary[];
  selectedKey: string | undefined;
  canEdit: boolean;
  onSelect: (key: string) => void;
  onCreated: (key: string) => void;
  /** Whether the create form is open. */
  creating: boolean;
  /** Opens or closes the create form. */
  onCreatingChange: (creating: boolean) => void;
  /** False on a wide screen, where the form takes the editor column. */
  inlineCreate?: boolean;
}

export function TypeList({
  spaceId,
  types,
  selectedKey,
  canEdit,
  onSelect,
  onCreated,
  creating,
  onCreatingChange,
  inlineCreate = true,
}: TypeListProps) {
  const [query, setQuery] = useState("");
  const needle = foldProperty(query);
  const matches =
    needle === ""
      ? types
      : types.filter(
          (type) =>
            foldProperty(type.name).includes(needle) ||
            foldProperty(type.key).includes(needle),
        );

  return (
    <section aria-labelledby="schema-types">
      <SectionRule id="schema-types" title="Types" count={types.length} />

      {canEdit && creating && inlineCreate ? (
        <TypeCreateForm
          spaceId={spaceId}
          onCreated={(key) => {
            onCreatingChange(false);
            onCreated(key);
          }}
          onCancel={() => onCreatingChange(false)}
        />
      ) : null}

      {types.length > 0 ? (
        <div className="flex items-center gap-2 border-b rule px-1 py-2">
          <Search aria-hidden size={13} className="shrink-0 text-faint" />
          <input
            type="search"
            value={query}
            aria-label="Search types"
            placeholder="Search names and keys."
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint pointer-coarse:h-11 pointer-coarse:text-base max-sm:h-11 max-sm:text-base"
          />
          <span className="tnum shrink-0 font-mono text-[11px] text-faint">
            {matches.length} of {types.length}
          </span>
        </div>
      ) : null}

      {types.length === 0 ? (
        <EmptyState sentence="No types yet. A type is a table; its properties are columns and its records are rows." />
      ) : matches.length === 0 ? (
        <p className="px-2.5 py-4 text-[13px] text-muted">
          No type matches “{query.trim()}”.
        </p>
      ) : (
        <ul>
          {matches.map((type) => {
            const current = type.key === selectedKey;
            return (
              <li key={type.key} className="border-b rule">
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 rounded-[12px] px-2.5 py-2.5 text-left transition-colors hover:text-accent aria-[current=true]:bg-accent-wash aria-[current=true]:text-accent-on-wash pointer-coarse:min-h-11"
                  onClick={() => onSelect(type.key)}
                >
                  <span className="mt-0.5">
                    <ThingIcon icon={type.icon} name={type.name} size="sm" />
                  </span>
                  <span className="grid min-w-0 gap-0.5">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-[15px]">{type.name}</span>
                      {type.schedule ? (
                        <span className="label shrink-0 text-accent-on-wash">scheduled</span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        "flex flex-wrap items-baseline justify-between gap-x-2 font-mono text-[11px] leading-4",
                        current ? "text-accent-on-wash" : "text-faint",
                      )}
                    >
                      <span className="truncate">{type.key}</span>
                      <span className="tnum shrink-0">
                        {type.property_count} {type.property_count === 1 ? "prop" : "props"} ·{" "}
                        {type.object_count} {type.object_count === 1 ? "record" : "records"}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface TypeCreateFormProps {
  spaceId: string;
  onCreated: (key: string) => void;
  onCancel: () => void;
}

/**
 * One new type: its name and plural, an optional icon, description and
 * scheduling. The key is minted from the name by the server and never changes;
 * the form says so before the reader commits.
 */
export function TypeCreateForm({
  spaceId,
  onCreated,
  onCancel,
}: TypeCreateFormProps) {
  const create = useCreateType(spaceId);
  const [schedule, setSchedule] = useState(false);
  const [icon, setIcon] = useState("");

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
        onSuccess: (created) => onCreated(created.key),
      },
    );
  }

  return (
    <section aria-labelledby="type-create" className="mt-3">
      <SectionRule id="type-create" level={3} title="New type" />
      <form className="mt-3 grid gap-3" onSubmit={onCreate}>
        <p className="border-l border-line-interactive pl-3 text-[12px] text-muted">
          The key is derived from the name, permanent, and used in file paths and CSV
          headers.
        </p>
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
          <IconPicker label="Icon" value={icon} onChange={setIcon} />
          <TextField label="Name" id="type-name" name="name" required maxLength={200} autoFocus />
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
        <ThumbRow className="flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={create.isPending}
            className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
          >
            {create.isPending ? "Creating…" : "Create type"}
          </Button>
        </ThumbRow>
      </form>
    </section>
  );
}
