/**
 * One request path: JSON in, JSON out, same-origin cookies, one error shape.
 *
 * The server always refuses with `{error:{code,message,details}}`, so a caller
 * shows `message` and switches on `code`; it never parses a status twice.
 */

export interface ApiErrorDetails {
  field?: string;
  errors?: { field: string; message: string }[];
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

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
