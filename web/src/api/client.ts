/**
 * One request path: JSON in, JSON out, same-origin cookies, one error shape.
 *
 * The server always refuses with `{error:{code,message,details}}`, so a caller
 * shows `message` and switches on `code`; it never parses a status twice.
 */

export interface ApiErrorDetails {
  field?: string;
  errors?: { row?: number; field?: string; message: string }[];
  current_rev?: number;
  reason?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetails;

  constructor(status: number, code: string, message: string, details: ApiErrorDetails = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: ApiErrorDetails };
}

/** One response path: JSON when there is a body, the same envelope when not. */
async function decode<T>(response: Response): Promise<T> {
  const text = await response.text();
  let parsed: unknown;
  if (text !== "") {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) {
    const envelope = (parsed ?? {}) as ErrorEnvelope;
    throw new ApiError(
      response.status,
      envelope.error?.code ?? "internal",
      envelope.error?.message ?? `The server refused the request (${response.status}).`,
      envelope.error?.details ?? {},
    );
  }

  return parsed as T;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;
  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "Could not reach the server. Check the connection and retry.");
  }

  return decode<T>(response);
}

/** Posts a file as `text/csv`; the server answers JSON or the same error envelope. */
export async function sendCsv<T>(
  path: string,
  file: File | Blob,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "text/csv",
      },
      body: file,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    // An aborted dry run is the user choosing another file, not a failure.
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError(0, "network", "Could not reach the server. Check the connection and retry.");
  }

  return decode<T>(response);
}

/** The filename a `Content-Disposition` header names, when it names one. */
function dispositionFilename(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return encoded[1].trim().replace(/^"|"$/g, "");
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header) ?? /filename=([^;]+)/i.exec(header);
  const name = plain?.[1]?.trim();
  return name ? name.replace(/^"|"$/g, "") : null;
}

/** Downloads a server response as a file, using its declared name when present. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      headers: { accept: "text/csv, application/json" },
    });
  } catch {
    throw new ApiError(0, "network", "Could not reach the server. Check the connection and retry.");
  }

  if (!response.ok) {
    await decode<unknown>(response);
    return;
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = dispositionFilename(response.headers.get("content-disposition")) ?? fallbackName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking in the same task can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
