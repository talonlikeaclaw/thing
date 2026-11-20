import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));
const packageJson: unknown = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
if (
  typeof packageJson !== "object" ||
  packageJson === null ||
  !("version" in packageJson) ||
  typeof packageJson.version !== "string"
) {
  throw new Error("web/package.json has no string version");
}
const packageVersion = packageJson.version;

// Hostnames Vite should answer on besides the IP addresses it always accepts.
// `THING_DEV_ALLOWED_HOSTS=a.local,b.example` covers mDNS/`/etc/hosts` names when
// the dev server is reached from another machine.
const extraAllowedHosts = (process.env.THING_DEV_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter((host) => host.length > 0);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
  },
  server: {
    port: 5173,
    // Tailscale Serve fronts the dev server over HTTPS so a phone on the
    // tailnet can reach it; Vite refuses a Host header it does not know.
    // Bare IP addresses are always accepted, so LAN access by `192.168.x.x`
    // needs nothing; named hosts come from `THING_DEV_ALLOWED_HOSTS`.
    allowedHosts: ["devbox.tail56f1e1.ts.net", ...extraAllowedHosts],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: false,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
  },
});
