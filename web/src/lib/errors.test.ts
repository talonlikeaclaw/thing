import { describe, expect, it } from "vitest";

import { ApiError } from "@/api/client";
import { classifyError } from "@/lib/errors";

describe("classifyError", () => {
  it("keeps a missing session separate from a signed-out visitor", () => {
    expect(classifyError(new ApiError(401, "unauthenticated", "no session"))).toMatchObject({
      kind: "unauthenticated",
      title: "Sign in again",
    });
  });

  it("names forbidden access and missing things", () => {
    expect(classifyError(new ApiError(403, "forbidden", "no access"))).toMatchObject({
      kind: "forbidden",
      message: "Ask an owner of this space to give you access.",
    });
    expect(classifyError(new ApiError(404, "not_found", "object x not found"), "Record")).toMatchObject({
      kind: "missing",
      title: "Record not found",
    });
  });

  it("makes network and server failures retryable", () => {
    expect(classifyError(new ApiError(0, "network", "offline"))).toMatchObject({
      kind: "retry",
      message: "offline",
    });
    expect(classifyError(new ApiError(503, "internal", "unavailable"))).toMatchObject({
      kind: "retry",
    });
    expect(classifyError(new TypeError("Failed to fetch"))).toMatchObject({ kind: "retry" });
  });

  it("leaves a refused write as a refusal, not a load failure", () => {
    expect(classifyError(new ApiError(422, "validation_failed", "title is required"))).toMatchObject({
      kind: "refused",
      message: "title is required",
    });
  });
});
