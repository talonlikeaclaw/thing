import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SpaceSummary, User } from "@/api/types";
import { ProfileTheme } from "@/components/profile-theme";
import { visitsKey } from "@/lib/visits";
import {
  jsonResponse,
  renderWithProviders,
  requestUrl,
  stubFetch,
} from "@/test/harness";

function account(overrides: Partial<User> = {}): User {
  return {
    id: "u1",
    email: "a@b.c",
    name: "Talon",
    accent: "cyan",
    accent_override: true,
    ...overrides,
  };
}

function space(id: string, accent: string | null): SpaceSummary {
  return {
    id,
    name: `Space ${id}`,
    icon: null,
    accent,
    role: "owner",
    member_count: 1,
    type_count: 1,
  };
}

/** A user's account, the list with their accents, and the last visit map. */
function stubApi({
  user = account(),
  spaces = [] as SpaceSummary[],
  visits = {} as Record<string, number>,
} = {}) {
  window.localStorage.setItem(visitsKey("u1"), JSON.stringify(visits));
  return stubFetch((input) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/auth/me")) {
      return jsonResponse(user);
    }
    if (url.endsWith("/api/spaces")) {
      return jsonResponse(spaces);
    }
    throw new Error(`unstubbed ${url}`);
  });
}

beforeEach(() => {
  document.documentElement.removeAttribute("data-accent");
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-accent");
  window.localStorage.clear();
});

describe("ProfileTheme", () => {
  it("applies the profile room outside a space when no space is selected", async () => {
    stubApi();

    renderWithProviders(<ProfileTheme inSpace={false} />);

    await waitFor(() => expect(document.documentElement.dataset.accent).toBe("cyan"));
  });

  it("leaves the space's own accent alone inside a space", async () => {
    const fetch = stubApi();

    renderWithProviders(<ProfileTheme inSpace />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(document.documentElement.dataset.accent).toBeUndefined();
  });

  it("themes the Spaces view from the last visited space when no profile accent is set", async () => {
    stubApi({
      user: account({ accent: null, accent_override: false }),
      spaces: [space("s1", "orange")],
      visits: { s1: 100 },
    });

    renderWithProviders(<ProfileTheme inSpace={false} />);

    await waitFor(() => expect(document.documentElement.dataset.accent).toBe("orange"));
  });

  it("applies the profile accent outside a space before the last space", async () => {
    stubApi({
      user: account({ accent_override: false }),
      spaces: [space("s1", "orange")],
      visits: { s1: 100 },
    });

    renderWithProviders(<ProfileTheme inSpace={false} />);

    await waitFor(() => expect(document.documentElement.dataset.accent).toBe("cyan"));
  });

  it("lets the profile override win over the last space", async () => {
    stubApi({
      user: account({ accent_override: true }),
      spaces: [space("s1", "orange")],
      visits: { s1: 100 },
    });

    renderWithProviders(<ProfileTheme inSpace={false} />);

    await waitFor(() => expect(document.documentElement.dataset.accent).toBe("cyan"));
  });

  it("keeps the profile room while the override is off and no space was visited", async () => {
    stubApi({
      user: account({ accent_override: false }),
      spaces: [space("s1", "orange")],
    });

    renderWithProviders(<ProfileTheme inSpace={false} />);

    await waitFor(() => expect(document.documentElement.dataset.accent).toBe("cyan"));
  });

  it("leaves the default room when nothing is selected", async () => {
    const fetch = stubApi({ user: account({ accent: null, accent_override: false }) });

    renderWithProviders(<ProfileTheme inSpace={false} />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(document.documentElement.dataset.accent).toBeUndefined();
  });
});
