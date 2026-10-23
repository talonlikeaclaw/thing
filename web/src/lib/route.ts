import { useEffect } from "react";

/** The product's one suffix; every route sets `document.title` through here. */
export function useRouteMeta(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · thing` : "thing";
  }, [title]);
}
