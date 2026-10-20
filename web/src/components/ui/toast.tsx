import { X } from "lucide-react";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/cn";

type ToastTone = "plain" | "danger";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  showToast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DISMISS_MS = 6000;

/** One transient sentence in the corner; refusals stay long enough to read. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, tone: ToastTone = "plain") => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) {
      return;
    }
    const timers = toasts.map((toast) => window.setTimeout(() => dismiss(toast.id), DISMISS_MS));
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [toasts, dismiss]);

  return (
    <ToastContext value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 grid w-[min(24rem,calc(100vw-2rem))] gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "danger" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-sheet border bg-surface px-4 py-3 text-[13px] shadow-none",
              toast.tone === "danger" ? "border-danger text-danger" : "border-line text-ink",
            )}
          >
            <p className="min-w-0 flex-1">{toast.message}</p>
            <button
              type="button"
              aria-label="Dismiss"
              className="-mr-1 -mt-0.5 inline-flex min-h-6 min-w-6 items-center justify-center text-faint transition-colors hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11"
              onClick={() => dismiss(toast.id)}
            >
              <X aria-hidden size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  const api = use(ToastContext);
  if (!api) {
    throw new Error("useToast needs a ToastProvider above it");
  }
  return api;
}
