import { createBrowserRouter } from "react-router";

import { AppShell, AuthGate } from "@/components/app-shell";
import { JoinPage } from "@/pages/join";
import { LoginPage } from "@/pages/login";
import { NotFoundPage } from "@/pages/not-found";
import { RegisterPage } from "@/pages/register";
import { SchemaPage } from "@/pages/schema";
import { SpacePage } from "@/pages/space";
import { SpaceListPage } from "@/pages/spaces";

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
          { path: "s/:spaceId/schema", element: <SchemaPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);
