import { Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useCsvPreview, useExportCsv, useImportCsv } from "@/api/queries";
import type { CsvProblem, TypeDef } from "@/api/types";
import { SmallButton } from "@/components/schema/small-button";
import { Button, FormError } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { readApiCreated, readApiProblems, readError } from "@/lib/display";

/** The server's per-file cap; a larger file is refused before it is uploaded. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const SHOWN_PREVIEW_ROWS = 5;
const SHOWN_PROBLEMS = 20;

interface DataPanelProps {
  spaceId: string;
  type: TypeDef;
  canEdit: boolean;
  /** A committed import closes the sheet and drops the page's selection. */
  onImported: () => void;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Values in a preview are typed JSON; this is a compact read-only rendering. */
function previewCell(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => previewCell(entry)).join(", ");
  }
  if (value !== null && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function problemLine(problem: CsvProblem): string {
  if (problem.row === 0) {
    return `file — ${problem.message}`;
  }
  return `row ${problem.row}${problem.field ? ` · ${problem.field}` : ""} — ${problem.message}`;
}

/**
 * Export and import for one type. Export is a read, so viewers get it; import
 * writes, so only editors see it. The dry run is a preview, not a commit: the
 * panel states how many rows would land and every problem before anything is
 * written.
 */
export function DataPanel({ spaceId, type, canEdit, onImported }: DataPanelProps) {
  const toast = useToast();
  const preview = useCsvPreview(spaceId, type.key);
  const commit = useImportCsv(spaceId, type.key);
  const download = useExportCsv(spaceId, type.key);
  const abortRef = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTemplate = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Closing the panel is a decision to stop reading the file.
  useEffect(() => () => abortRef.current?.abort(), []);

  const pending = preview.isPending || commit.isPending;
  const result = preview.data;
  const commitProblems = readApiProblems(commit.error);
  const requestProblems = isAbort(preview.error) ? [] : readApiProblems(preview.error);
  const problems = commit.error ? commitProblems : (result?.errors ?? requestProblems);
  const written = readApiCreated(commit.error);

  const problemRows = new Set(
    problems.filter((problem) => problem.row !== undefined && problem.row > 0).map((problem) => problem.row),
  );
  const validRows = result === undefined ? 0 : Math.max(0, result.rows - problemRows.size);

  function startExport(template: boolean) {
    lastTemplate.current = template;
    setExportError(null);
    download.mutate(template, {
      onError: (error) => setExportError(readError(error)),
    });
  }

  function choose(next: File | null) {
    abortRef.current?.abort();
    abortRef.current = null;
    preview.reset();
    commit.reset();
    setRefusal(null);
    setFile(next);
    if (next === null) {
      return;
    }
    if (!next.name.toLowerCase().endsWith(".csv") && next.type !== "text/csv") {
      setRefusal("expected text/csv");
      return;
    }
    if (next.size > MAX_IMPORT_BYTES) {
      setRefusal(`the file is ${next.size} bytes; the limit is 5 MiB`);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    preview.mutate({ file: next, signal: controller.signal });
  }

  /** Clearing the field's value as well lets the same file be chosen again. */
  function clearFile() {
    if (fileInput.current !== null) {
      fileInput.current.value = "";
    }
    choose(null);
  }

  function runImport() {
    if (file === null || result === undefined || !result.valid || result.rows === 0) {
      return;
    }
    commit.mutate(file, {
      onSuccess: (done) => {
        toast.showToast(
          `Imported ${done.count} ${done.count === 1 ? "record" : "records"}.`,
        );
        onImported();
      },
    });
  }

  const importLabel =
    result === undefined
      ? "Import records"
      : !result.valid
        ? "Fix problems to import"
        : `Import ${result.rows} ${result.rows === 1 ? "record" : "records"}`;

  return (
    <section aria-label="CSV import and export" className="grid gap-5">
      <div className="grid gap-3">
        <div>
          <h4 className="text-[13px] font-medium text-ink">Export</h4>
          <p className="mt-0.5 text-[12px] leading-[1.5] text-muted">
            Every live record of this type, one row each. Columns are property keys; lists
            and recurrences are JSON.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
            disabled={download.isPending}
            onClick={() => startExport(false)}
          >
            {download.isPending && download.variables === false
              ? "Preparing…"
              : "Download CSV"}
          </Button>
          {canEdit ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
              disabled={download.isPending}
              onClick={() => startExport(true)}
            >
              {download.isPending && download.variables === true
                ? "Preparing…"
                : "Download template"}
            </Button>
          ) : null}
        </div>
        {exportError ? (
          <div className="grid gap-2">
            <FormError message={exportError} />
            <Button
              type="button"
              variant="ghost"
              className="w-fit min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
              disabled={download.isPending}
              onClick={() => startExport(lastTemplate.current)}
            >
              Retry
            </Button>
          </div>
        ) : null}
      </div>

      {canEdit ? (
        <div className="grid gap-3 border-t rule pt-4">
          <div>
            <h4 className="text-[13px] font-medium text-ink">Import</h4>
            <p className="mt-0.5 text-[12px] leading-[1.5] text-muted">
              The header row must use this type&apos;s property keys. Empty cells mean no
              value. Relations use record IDs.
            </p>
          </div>

          {/*
            The field is the button: a file input's own chrome belongs to no
            design system, and the chosen name is the state worth showing.
          */}
          <div className="grid gap-2">
            <input
              ref={fileInput}
              id={`csv-file-${type.key}`}
              type="file"
              accept=".csv,text/csv"
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
              disabled={pending}
              onChange={(event) => choose(event.target.files?.[0] ?? null)}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                className="min-h-9 shrink-0 px-3 text-[13px] pointer-coarse:min-h-11"
                disabled={pending}
                aria-describedby={`csv-file-hint-${type.key}`}
                onClick={() => fileInput.current?.click()}
              >
                <Upload aria-hidden size={14} />
                {file === null ? "Choose a CSV file" : "Choose another file"}
              </Button>
              <span
                className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted"
                title={file?.name}
              >
                {file?.name ?? "No file chosen"}
              </span>
              {file !== null ? (
                <SmallButton
                  label="Clear the chosen file"
                  disabled={pending}
                  onClick={clearFile}
                >
                  <X aria-hidden size={15} />
                </SmallButton>
              ) : null}
            </div>
            <span id={`csv-file-hint-${type.key}`} className="text-[12px] text-faint">
              A .csv file up to 5 MiB. Broken rows are refused by row and column before
              anything is written.
            </span>
          </div>

          {refusal ? <FormError message={refusal} /> : null}
          {preview.isPending ? (
            <p role="status" className="text-[13px] text-muted">
              Reading the file…
            </p>
          ) : null}
          {file !== null && result !== undefined ? (
            <p role="status" className="text-[13px]">
              {result.valid
                ? `${result.rows} ${result.rows === 1 ? "row" : "rows"} ready.`
                : `${validRows} valid ${validRows === 1 ? "row" : "rows"}; ${problems.length} ${
                    problems.length === 1 ? "problem" : "problems"
                  }.`}
            </p>
          ) : null}

          {result !== undefined && result.preview.length > 0 ? (
            <div>
              <span className="label">First valid rows</span>
              <ul className="mt-1 grid gap-1">
                {result.preview.slice(0, SHOWN_PREVIEW_ROWS).map((row) => {
                  const values = Object.entries(row.values).filter(
                    ([, value]) => value !== null && value !== "" && value !== undefined,
                  );
                  return (
                    <li
                      key={row.row}
                      id={`csv-preview-row-${row.row}`}
                      className="border-b rule pb-1 text-[12px]"
                    >
                      <span className="font-medium">{row.title}</span>
                      {values.length > 0 ? (
                        <span className="ml-2 font-mono text-[11px] text-muted">
                          {values
                            .map(([key, value]) => `${key}: ${previewCell(value)}`)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {problems.length > 0 ? (
            <div>
              <span className="label">Problems</span>
              <ul className="mt-1 grid gap-1">
                {problems.slice(0, SHOWN_PROBLEMS).map((problem, index) => (
                  <li
                    key={`${problem.row ?? 0}-${problem.field ?? "csv"}-${index}`}
                    className="font-mono text-[11px] text-danger"
                  >
                    {problemLine({
                      row: problem.row ?? 0,
                      field: problem.field ?? "",
                      message: problem.message,
                    })}
                  </li>
                ))}
              </ul>
              {problems.length > SHOWN_PROBLEMS ? (
                <p className="mt-1 text-[12px] text-faint">
                  Showing the first {SHOWN_PROBLEMS} of {problems.length} problems.
                </p>
              ) : null}
            </div>
          ) : null}

          {commit.error && commitProblems.length === 0 ? (
            <FormError
              message={
                written === undefined
                  ? readError(commit.error)
                  : `${readError(commit.error)} ${written} ${
                      written === 1 ? "record was" : "records were"
                    } written before the failure.`
              }
            />
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
              disabled={pending || result === undefined || !result.valid || result.rows === 0}
              onClick={runImport}
            >
              {commit.isPending ? "Importing…" : importLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
