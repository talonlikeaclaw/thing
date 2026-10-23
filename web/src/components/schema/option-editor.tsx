import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useRef, useState } from "react";

import { SmallButton } from "@/components/schema/small-button";
import { Button } from "@/components/ui/controls";
import {
  colorValue,
  DEFAULT_OPTION_COLOR,
  moveItem,
  type OptionDraft,
} from "@/lib/schema";

interface OptionEditorProps {
  drafts: OptionDraft[];
  onChange: (drafts: OptionDraft[]) => void;
  canEdit: boolean;
  idPrefix: string;
}

const optionFieldStyles =
  "h-9 min-w-0 rounded-field border border-line-interactive bg-ground px-2 text-[14px] text-ink transition-colors hover:border-line-strong focus:border-accent pointer-coarse:h-11";

/** Options in display order, with inline creation; nothing is saved until Save. */
export function OptionEditor({ drafts, onChange, canEdit, idPrefix }: OptionEditorProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_OPTION_COLOR);
  const counter = useRef(0);

  function add() {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    onChange([
      ...drafts,
      { id: `${idPrefix}-new-${counter.current++}`, name: trimmed, color },
    ]);
    setName("");
  }

  function rename(id: string, next: string) {
    onChange(drafts.map((draft) => (draft.id === id ? { ...draft, name: next } : draft)));
  }

  function recolor(id: string, next: string) {
    onChange(drafts.map((draft) => (draft.id === id ? { ...draft, color: next } : draft)));
  }

  function move(id: string, delta: number) {
    const from = drafts.findIndex((draft) => draft.id === id);
    if (from !== -1) {
      onChange(moveItem(drafts, from, from + delta));
    }
  }

  function remove(id: string) {
    onChange(drafts.filter((draft) => draft.id !== id));
  }

  return (
    <div className="grid gap-2">
      {drafts.length === 0 ? (
        <p className="text-[13px] text-muted">No options yet; add the first one below.</p>
      ) : (
        <ul>
          {drafts.map((draft, index) => (
            <li
              key={draft.id}
              className="flex flex-wrap items-center gap-2 border-b rule py-2"
            >
              <input
                type="color"
                aria-label={`${draft.name || "Option"} colour`}
                className="h-8 w-8 shrink-0 cursor-pointer rounded-[4px] border border-line bg-ground p-0.5 pointer-coarse:h-11 pointer-coarse:w-11"
                value={colorValue(draft.color)}
                disabled={!canEdit}
                onChange={(event) => recolor(draft.id, event.target.value)}
              />
              <input
                aria-label={`Option ${index + 1} name`}
                className={`${optionFieldStyles} flex-1`}
                value={draft.name}
                maxLength={200}
                disabled={!canEdit}
                onChange={(event) => rename(draft.id, event.target.value)}
              />
              {draft.key ? (
                <span className="font-mono text-[10px] text-faint">{draft.key}</span>
              ) : (
                <span className="label text-faint">new</span>
              )}
              <div className="flex items-center gap-1">
                <SmallButton
                  label={`Move ${draft.name || "option"} up`}
                  disabled={!canEdit || index === 0}
                  onClick={() => move(draft.id, -1)}
                >
                  <ChevronUp aria-hidden size={15} />
                </SmallButton>
                <SmallButton
                  label={`Move ${draft.name || "option"} down`}
                  disabled={!canEdit || index === drafts.length - 1}
                  onClick={() => move(draft.id, 1)}
                >
                  <ChevronDown aria-hidden size={15} />
                </SmallButton>
                <SmallButton
                  label={`Remove ${draft.name || "option"}`}
                  disabled={!canEdit}
                  onClick={() => remove(draft.id)}
                >
                  <X aria-hidden size={15} />
                </SmallButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            type="color"
            aria-label="New option colour"
            className="h-9 w-9 shrink-0 cursor-pointer rounded-[4px] border border-line bg-ground p-0.5 pointer-coarse:h-11 pointer-coarse:w-11"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
          <input
            aria-label="New option name"
            className={`${optionFieldStyles} flex-1`}
            placeholder="New option"
            value={name}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            className="min-h-9 px-3 text-[13px]"
            disabled={!name.trim()}
            onClick={add}
          >
            <Plus aria-hidden size={15} />
            Add option
          </Button>
        </div>
      ) : null}
    </div>
  );
}
