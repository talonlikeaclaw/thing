import { Minus, Plus, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useThumbHandedness } from "@/components/handedness";
import { cn } from "@/lib/cn";

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.6;
/** Pointer travel under this many CSS pixels is a tap, not a drag. */
const DRAG_THRESHOLD = 3;

interface View {
  zoom: number;
  /** Pan in viewBox units, applied before the scale. */
  x: number;
  y: number;
}

const RESET_VIEW: View = { zoom: 1, x: 0, y: 0 };

interface GraphCanvasProps {
  width: number;
  height: number;
  label: string;
  /** A change to this value — a different record or scope — resets pan and zoom. */
  resetKey: string;
  legend: ReactNode;
  hint: string;
  /** Extra view controls, set before the zoom cluster in the same row. */
  actions?: ReactNode;
  /** Moves one node by a delta in graph units; edges are drawn by the caller. */
  onNodeDrag?: (id: string, dx: number, dy: number) => void;
  children: ReactNode;
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * The shared interactive surface for both graphs: a responsive `viewBox` that
 * pans by dragging, zooms around the pointer, and keeps a tap on a node a tap.
 * The drawing is supplied as children and moves as one group.
 */
export function GraphCanvas({
  width,
  height,
  label,
  resetKey,
  legend,
  hint,
  actions,
  onNodeDrag,
  children,
}: GraphCanvasProps) {
  const handedness = useThumbHandedness();
  const leftHanded = handedness === "left";
  const [view, setView] = useState<View>(RESET_VIEW);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    pointer: number;
    clientX: number;
    clientY: number;
    view: View;
    unitX: number;
    unitY: number;
    moved: boolean;
    /** Set when the press started on a node; null means pan the canvas. */
    nodeId: string | null;
    lastX: number;
    lastY: number;
  } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    setView(RESET_VIEW);
  }, [resetKey, width]);

  // React's wheel listener is passive, and a zoom that scrolls the page with it
  // is worse than no zoom, so the listener is native and non-passive.
  useEffect(() => {
    const element = svgRef.current;
    if (!element) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) {
        return;
      }
      const pointX = ((event.clientX - box.left) / box.width) * width;
      const pointY = ((event.clientY - box.top) / box.height) * height;
      const factor = Math.exp(-event.deltaY * 0.0015);
      setView((current) => {
        const zoom = clampZoom(current.zoom * factor);
        return {
          zoom,
          x: current.x + (current.zoom - zoom) * pointX,
          y: current.y + (current.zoom - zoom) * pointY,
        };
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [width, height]);

  const zoomBy = (factor: number) => {
    const pointX = width / 2;
    const pointY = height / 2;
    setView((current) => {
      const zoom = clampZoom(current.zoom * factor);
      return {
        zoom,
        x: current.x + (current.zoom - zoom) * pointX,
        y: current.y + (current.zoom - zoom) * pointY,
      };
    });
  };

  return (
    <figure className="m-0">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={label}
        className={cn(
          "mx-auto block h-auto w-full max-w-[44rem] touch-none select-none",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        onClickCapture={(event) => {
          if (!suppressClick.current) {
            return;
          }
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) {
            return;
          }
          if (drag.current && drag.current.pointer !== event.pointerId) {
            return;
          }
          const box = event.currentTarget.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) {
            return;
          }
          const target = event.target as Element;
          // A finger always pans. Node dragging is a precision gesture for a
          // mouse or pen; on touch it would race the page and the pan.
          const nodeId =
            onNodeDrag && event.pointerType !== "touch"
              ? (target.closest?.("[data-node-id]")?.getAttribute("data-node-id") ?? null)
              : null;
          drag.current = {
            pointer: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            view,
            // A node lives before the view's scale; divide it back out so a
            // dragged node follows the pointer at any zoom.
            unitX: width / box.width / (nodeId ? view.zoom : 1),
            unitY: height / box.height / (nodeId ? view.zoom : 1),
            moved: false,
            nodeId: nodeId ?? null,
            lastX: event.clientX,
            lastY: event.clientY,
          };
          suppressClick.current = false;
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.pointer !== event.pointerId) {
            return;
          }
          const dx = event.clientX - start.clientX;
          const dy = event.clientY - start.clientY;
          if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
            return;
          }
          if (start.nodeId && onNodeDrag) {
            onNodeDrag(
              start.nodeId,
              (event.clientX - start.lastX) * start.unitX,
              (event.clientY - start.lastY) * start.unitY,
            );
            start.lastX = event.clientX;
            start.lastY = event.clientY;
          } else {
            setView({
              zoom: start.view.zoom,
              x: start.view.x + dx * start.unitX,
              y: start.view.y + dy * start.unitY,
            });
          }
          if (!start.moved) {
            start.moved = true;
            setDragging(true);
            // Capture only once this is a drag: capturing on pointerdown retargets
            // the click and the record under the finger would stop opening.
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // A synthetic or already-released pointer has nothing to capture;
              // the drag still follows while the pointer stays over the field.
            }
          }
        }}
        onPointerUp={(event) => {
          const start = drag.current;
          if (!start || start.pointer !== event.pointerId) {
            return;
          }
          suppressClick.current = start.moved;
          drag.current = null;
          setDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>{children}</g>
      </svg>

      <figcaption className="mt-1 grid gap-1 font-mono text-[11px] text-faint">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {legend}
          <span className="text-faint">{hint}</span>
        </span>
        <span
          className={cn(
            "flex items-center gap-1",
            leftHanded ? "justify-start" : "justify-end",
          )}
        >
          {actions}
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            className="inline-flex size-8 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-line-strong hover:text-ink pointer-coarse:size-11"
            onClick={() => zoomBy(1.25)}
          >
            <Plus aria-hidden size={14} />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            className="inline-flex size-8 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-line-strong hover:text-ink pointer-coarse:size-11"
            onClick={() => zoomBy(0.8)}
          >
            <Minus aria-hidden size={14} />
          </button>
          <button
            type="button"
            aria-label="Reset graph view"
            title="Reset graph view"
            className="inline-flex size-8 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-line-strong hover:text-ink pointer-coarse:size-11"
            onClick={() => setView(RESET_VIEW)}
          >
            <RotateCcw aria-hidden size={14} />
          </button>
        </span>
      </figcaption>
    </figure>
  );
}
