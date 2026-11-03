import "@fontsource-variable/ibm-plex-sans/index.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-serif/400.css";
import "@fontsource/ibm-plex-serif/500.css";

import { createRoot } from "react-dom/client";

import { App } from "@/App";
import "@/styles/globals.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("index.html has no #root; the app cannot mount");
}

createRoot(root).render(<App />);
