import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter } from "react-router";

import { AppShell, AuthGate } from "@/components/app-shell";
import { SpaceLayout } from "@/components/space-layout";

// Pages load in their own chunks: the shell and the space layout are the only
// eager surfaces, so a first visit never downloads the editor, schema, or
// changelog. Named exports are mapped to the default React.lazy expects.
const AgendaPage = lazy(() =>
  import("@/pages/agenda").then((module) => ({ default: module.AgendaPage })),
);
const ChangelogPage = lazy(() =>
  import("@/pages/changelog").then((module) => ({ default: module.ChangelogPage })),
);
const JoinPage = lazy(() =>
  import("@/pages/join").then((module) => ({ default: module.JoinPage })),
);
const LibraryPage = lazy(() =>
  import("@/pages/library").then((module) => ({ default: module.LibraryPage })),
);
const LoginPage = lazy(() =>
  import("@/pages/login").then((module) => ({ default: module.LoginPage })),
);
const MembersPage = lazy(() =>
  import("@/pages/members").then((module) => ({ default: module.MembersPage })),
);
const NotFoundPage = lazy(() =>
  import("@/pages/not-found").then((module) => ({ default: module.NotFoundPage })),
);
const ObjectPage = lazy(() =>
  import("@/pages/object").then((module) => ({ default: module.ObjectPage })),
);
const RegisterPage = lazy(() =>
  import("@/pages/register").then((module) => ({ default: module.RegisterPage })),
);
const SchemaPage = lazy(() =>
  import("@/pages/schema").then((module) => ({ default: module.SchemaPage })),
);
const SettingsPage = lazy(() =>
  import("@/pages/settings").then((module) => ({ default: module.SettingsPage })),
);
const SpacePage = lazy(() =>
  import("@/pages/space").then((module) => ({ default: module.SpacePage })),
);
const SpaceListPage = lazy(() =>
  import("@/pages/spaces").then((module) => ({ default: module.SpaceListPage })),
);
const TrashPage = lazy(() =>
  import("@/pages/trash").then((module) => ({ default: module.TrashPage })),
);
const TypeTablePage = lazy(() =>
  import("@/pages/type-table").then((module) => ({ default: module.TypeTablePage })),
);
const UserSettingsPage = lazy(() =>
  import("@/pages/user-settings").then((module) => ({ default: module.UserSettingsPage })),
);

/** The route's chunk is in flight; the shell keeps its frame around it. */
function page(element: ReactNode): ReactNode {
  return (
    <Suspense
      fallback={
        <p className="py-10 text-[13px] text-muted" role="status">
          Reading…
        </p>
      }
    >
      {element}
    </Suspense>
  );
}

export const router = createBrowserRouter([
  { path: "/login", element: page(<LoginPage />) },
  { path: "/register", element: page(<RegisterPage />) },
  { path: "/join/:code", element: page(<JoinPage />) },
  {
    element: <AuthGate />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: page(<SpaceListPage />) },
          { path: "settings", element: page(<UserSettingsPage />) },
          {
            path: "s/:spaceId",
            element: <SpaceLayout />,
            children: [
              { index: true, element: page(<SpacePage />) },
              { path: "t/:typeKey", element: page(<TypeTablePage />) },
              { path: "agenda", element: page(<AgendaPage />) },
              { path: "library", element: page(<LibraryPage />) },
              { path: "o/:objectId", element: page(<ObjectPage />) },
              { path: "schema", element: page(<SchemaPage />) },
              { path: "members", element: page(<MembersPage />) },
              { path: "settings", element: page(<SettingsPage />) },
              { path: "trash", element: page(<TrashPage />) },
            ],
          },
          { path: "changelog", element: page(<ChangelogPage />) },
        ],
      },
    ],
  },
  { path: "*", element: page(<NotFoundPage />) },
]);
