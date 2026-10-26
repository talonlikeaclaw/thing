import { X } from "lucide-react";
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
  onClose: () => void;
  /** A committed import closes the panel and drops the page's selection. */
  onImported: () => void;
  /** Rendered inside a sheet that already supplies the title and close. */
  embedded?: boolean;
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
export function DataPanel({
  spaceId,
  type,
  canEdit,
  onClose,
  onImported,
  embedded = false,
}: DataPanelProps) {
  const toast = useToast();
  const preview = useCsvPreview(spaceId, type.key);
  const commit = useImportCsv(spaceId, type.key);
  const download = useExportCsv(spaceId, type.key);
  const abortRef = useRef<AbortController | null>(null);
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
    <section
      aria-labelledby={embedded ? undefined : `data-panel-${type.key}`}
      aria-label={embedded ? "Data — CSV" : undefined}
      className={embedded ? undefined : "mt-3 border-y rule py-3"}
    >
      {embedded ? (
        <p className="text-[12px] text-faint">One type at a time.</p>
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span id={`data-panel-${type.key}`} className="label">
            Data — CSV
          </span>
          <span className="flex items-center gap-2">
            <span className="text-[12px] text-faint">One type at a time.</span>
            <SmallButton label="Close data panel" onClick={onClose}>
              <X aria-hidden size={15} />
            </SmallButton>
          </span>
        </div>
      )}

      <div className="mt-3 grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-3">
          <h2 className="text-[14px] font-medium">Export</h2>
          <p className="text-[13px] text-muted">
            Every live record of this type, one row each. Columns are property keys; lists
            and recurrences are JSON.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
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
                className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
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
                className="w-fit min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
                disabled={download.isPending}
                onClick={() => startExport(lastTemplate.current)}
              >
                Retry
              </Button>
            </div>
          ) : null}
        </div>

        {canEdit ? (
          <div className="grid content-start gap-3 border-t rule pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
            <h2 className="text-[14px] font-medium">Import</h2>
            <p className="text-[13px] text-muted">
              The header row must use this type&apos;s property keys. Empty cells mean no
              value. Relations use record IDs.
            </p>
            <div className="grid gap-1.5">
              <label htmlFor={`csv-file-${type.key}`} className="label">
                CSV file
              </label>
              <input
                id={`csv-file-${type.key}`}
                type="file"
                accept=".csv,text/csv"
                disabled={commit.isPending}
                aria-describedby={`csv-file-hint-${type.key}`}
                className="w-full rounded-field border border-line-interactive bg-ground px-3 py-2 text-[13px] text-ink file:mr-3 file:rounded-field file:border file:border-line-interactive file:bg-raised file:px-2.5 file:py-1 file:text-[12px] file:text-ink pointer-coarse:min-h-11 pointer-coarse:text-[16px]"
                onChange={(event) => choose(event.target.files?.[0] ?? null)}
              />
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
                className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
                disabled={pending || result === undefined || !result.valid || result.rows === 0}
                onClick={runImport}
              >
                {commit.isPending ? "Importing…" : importLabel}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
