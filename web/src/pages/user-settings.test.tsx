import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { User } from "@/api/types";
import { ProfileTheme } from "@/components/profile-theme";
import { UserSettingsPage } from "@/pages/user-settings";
import {
  jsonResponse,
  renderWithProviders,
  requestUrl,
  stubFetch,
} from "@/test/harness";

function stubAccount() {
  let user: User = {
    id: "u1",
    email: "a@b.c",
    name: "Talon",
    accent: null,
    accent_override: false,
  };
  const patches: unknown[] = [];
  stubFetch((input, init) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/spaces")) {
      return jsonResponse([]);
    }
    if (!url.endsWith("/api/auth/me")) {
      throw new Error(`unstubbed ${url}`);
    }
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as Partial<User>;
      patches.push(body);
      user = { ...user, ...body };
    }
    return jsonResponse(user);
  });
  return patches;
}

describe("UserSettingsPage", () => {
  it("stores a profile theme and the space override with the account", async () => {
    const patches = stubAccount();
    renderWithProviders(<UserSettingsPage />, { route: "/settings" });

    expect(await screen.findByText("Talon")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Cyan" }));
    await waitFor(() => expect(patches).toContainEqual({ accent: "cyan" }));
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Cyan" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Use this theme in every space" }));
    await waitFor(() =>
      expect(patches).toContainEqual({ accent: "cyan", accent_override: true }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Use this theme in every space" }),
    ).toBeChecked();
  });

  it("paints the chosen profile theme before the write returns", async () => {
    // ES2022 has no `Promise.withResolvers`; the executor is the typed gate.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let user: User = {
      id: "u1",
      email: "a@b.c",
      name: "Talon",
      accent: null,
      accent_override: false,
    };
    stubFetch(async (input, init) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/spaces")) {
        return jsonResponse([]);
      }
      if (!url.endsWith("/api/auth/me")) {
        throw new Error(`unstubbed ${url}`);
      }
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as Partial<User>;
        await gate;
        user = { ...user, ...body };
      }
      return jsonResponse(user);
    });

    renderWithProviders(
      <>
        <ProfileTheme inSpace={false} />
        <UserSettingsPage />
      </>,
      { route: "/settings" },
    );

    expect(await screen.findByText("Talon")).toBeInTheDocument();
    expect(document.documentElement.dataset.accent).toBeUndefined();

    fireEvent.click(screen.getByRole("radio", { name: "Pink" }));

    await waitFor(() => expect(document.documentElement.dataset.accent).toBe("pink"));

    release();
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Pink" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
  });
});
