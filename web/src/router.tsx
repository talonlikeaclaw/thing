import { createBrowserRouter } from "react-router";

import { AppShell, AuthGate } from "@/components/app-shell";
import { SpaceLayout } from "@/components/space-layout";
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
import { UserSettingsPage } from "@/pages/user-settings";

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
          { path: "settings", element: <UserSettingsPage /> },
          {
            path: "s/:spaceId",
            element: <SpaceLayout />,
            children: [
              { index: true, element: <SpacePage /> },
              { path: "t/:typeKey", element: <TypeTablePage /> },
              { path: "agenda", element: <AgendaPage /> },
              { path: "o/:objectId", element: <ObjectPage /> },
              { path: "schema", element: <SchemaPage /> },
              { path: "members", element: <MembersPage /> },
              { path: "settings", element: <SettingsPage /> },
              { path: "trash", element: <TrashPage /> },
            ],
          },
          { path: "changelog", element: <ChangelogPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);
