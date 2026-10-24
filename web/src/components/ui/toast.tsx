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

export interface ToastAction {
  label: string;
  onAction: () => void;
}

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  actions: ToastAction[];
}

interface ToastApi {
  showToast: (
    message: string,
    tone?: ToastTone,
    action?: ToastAction | ToastAction[],
  ) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DISMISS_MS = 6000;
const MAX_VISIBLE = 4;

/** One transient sentence in the corner; refusals stay until dismissed. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (
      message: string,
      tone: ToastTone = "plain",
      action?: ToastAction | ToastAction[],
    ) => {
      const id = nextId.current++;
      const actions = action === undefined ? [] : Array.isArray(action) ? action : [action];
      setToasts((current) => {
        const next = [...current, { id, message, tone, actions }];
        if (next.length <= MAX_VISIBLE) {
          return next;
        }
        // An action toast owns its Undo; only a plain or danger toast may go.
        const evictable = next.findIndex((toast) => toast.actions.length === 0);
        if (evictable !== -1) {
          next.splice(evictable, 1);
        }
        return next;
      });
    },
    [],
  );

  return (
    <ToastContext value={{ showToast }}>
      {children}
      <div className="toast-stack pointer-events-none fixed z-50 grid w-[min(24rem,calc(100vw-2rem))] gap-2">
        {toasts.map((toast) => (
          <ToastRow key={toast.id} toast={toast} dismiss={dismiss} />
        ))}
      </div>
    </ToastContext>
  );
}

type ToastRowProps = {
  toast: Toast;
  dismiss: (id: number) => void;
};

/**
 * Each toast owns its timer, pauses while hovered or focused, and is its own
 * live region. A danger toast never auto-dismisses.
 */
function ToastRow({ toast, dismiss }: ToastRowProps) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(DISMISS_MS);

  useEffect(() => {
    if (toast.tone === "danger" || paused) {
      return;
    }
    const started = Date.now();
    const timer = window.setTimeout(() => dismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [toast.id, toast.tone, paused, dismiss]);

  return (
    <div
      role={toast.tone === "danger" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-sheet border bg-surface px-4 py-3 text-[13px] shadow-none",
        toast.tone === "danger" ? "border-danger text-danger" : "border-line text-ink",
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <p className="min-w-0 flex-1">{toast.message}</p>
      {toast.actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className="shrink-0 text-[13px] text-accent underline decoration-accent/50 underline-offset-2 hover:decoration-accent pointer-coarse:min-h-11"
          onClick={() => {
            action.onAction();
            dismiss(toast.id);
          }}
        >
          {action.label}
        </button>
      ))}
      <button
        type="button"
        aria-label="Dismiss"
        className="-mr-1 -mt-0.5 inline-flex min-h-6 min-w-6 items-center justify-center text-faint transition-colors hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        onClick={() => dismiss(toast.id)}
      >
        <X aria-hidden size={14} />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const api = use(ToastContext);
  if (!api) {
    throw new Error("useToast needs a ToastProvider above it");
  }
  return api;
}
