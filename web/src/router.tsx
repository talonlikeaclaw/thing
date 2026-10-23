import { createBrowserRouter } from "react-router";

import { AppShell, AuthGate } from "@/components/app-shell";
import { AgendaPage } from "@/pages/agenda";
import { ChangelogPage } from "@/pages/changelog";
import { JoinPage } from "@/pages/join";
import { LoginPage } from "@/pages/login";
import { MembersPage } from "@/pages/members";
import { NotFoundPage } from "@/pages/not-found";
import { ObjectPage } from "@/pages/object";
import { RegisterPage } from "@/pages/register";
import { SchemaPage } from "@/pages/schema";
import { SettingsPage } from "@/pages/settings";
import { SpacePage } from "@/pages/space";
import { SpaceListPage } from "@/pages/spaces";
import { TrashPage } from "@/pages/trash";
import { TypeTablePage } from "@/pages/type-table";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  { path: "/join/:code", element: <JoinPage /> },
  {
    element: <AuthGate />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <SpaceListPage /> },
          { path: "s/:spaceId", element: <SpacePage /> },
          { path: "s/:spaceId/t/:typeKey", element: <TypeTablePage /> },
          { path: "s/:spaceId/agenda", element: <AgendaPage /> },
          { path: "s/:spaceId/o/:objectId", element: <ObjectPage /> },
          { path: "s/:spaceId/schema", element: <SchemaPage /> },
          { path: "s/:spaceId/members", element: <MembersPage /> },
          { path: "s/:spaceId/settings", element: <SettingsPage /> },
          { path: "s/:spaceId/trash", element: <TrashPage /> },
          { path: "changelog", element: <ChangelogPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);
