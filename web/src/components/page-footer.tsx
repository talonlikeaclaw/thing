import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * The shell owns the page's one footer rule; a page contributes its own line
 * to that row rather than printing a second `<footer>` directly above it. The
 * cover's file-backed colophon is the only consumer today: it belongs to the
 * space, while the changelog line and version belong to the shell.
 */
interface FooterSlot {
  render: (() => ReactNode) | null;
  set: (render: (() => ReactNode) | null) => void;
}

const NO_SLOT: FooterSlot = { render: null, set: () => {} };

const PageFooterContext = createContext<FooterSlot>(NO_SLOT);

export function PageFooterProvider({ children }: { children: ReactNode }) {
  const [render, setRender] = useState<(() => ReactNode) | null>(null);
  // React reads a function argument to `setState` as an updater, so the slot's
  // own function is wrapped to store it rather than call it.
  const set = useCallback(
    (next: (() => ReactNode) | null) => setRender(next ? () => next : null),
    [],
  );
  const value = useMemo(() => ({ render, set }), [render, set]);
  return <PageFooterContext.Provider value={value}>{children}</PageFooterContext.Provider>;
}

/** What the shell footer renders beside its own line, if a page set one. */
export function usePageFooterSlot(): (() => ReactNode) | null {
  return useContext(PageFooterContext).render;
}

/**
 * Contribute a line to the shell footer for as long as this page is mounted.
 * The factory is read through a ref, so a page may pass a closure over data
 * that arrives after mount without re-registering the slot.
 */
export function usePageFooter(factory: () => ReactNode) {
  const { set } = useContext(PageFooterContext);
  const latest = useRef(factory);
  latest.current = factory;
  useEffect(() => {
    set(latest.current);
    return () => set(null);
  }, [set]);
}
