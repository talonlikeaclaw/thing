import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, request } from "@/api/client";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request", () => {
  it("sends JSON with same-origin cookies and returns the parsed body", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ id: "1", name: "Garden" }));
    vi.stubGlobal("fetch", fetch);

    const space = await request<{ id: string; name: string }>("/api/spaces", {
      method: "POST",
      body: { name: "Garden" },
    });

    expect(space.name).toBe("Garden");
    expect(fetch).toHaveBeenCalledWith(
      "/api/spaces",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ name: "Garden" }),
        headers: expect.objectContaining({ "content-type": "application/json" }),
      }),
    );
  });

  it("turns the server's error envelope into an ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: "validation_failed",
              message: "the password is too short",
              details: { field: "password" },
            },
          },
          422,
        ),
      ),
    );

    const failure = await request("/api/auth/register", { method: "POST", body: {} }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ApiError);
    const error = failure as ApiError;
    expect(error.status).toBe(422);
    expect(error.code).toBe("validation_failed");
    expect(error.message).toBe("the password is too short");
    expect(error.details.field).toBe("password");
  });

  it("returns nothing for a bodiless 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(request<void>("/api/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("reports an unreachable server as a network ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed to fetch")));

    const failure = await request("/api/auth/me").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("network");
    expect((failure as ApiError).status).toBe(0);
  });
});
