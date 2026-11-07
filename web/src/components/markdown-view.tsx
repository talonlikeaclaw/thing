import { useEffect, useMemo, useRef, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import { Link } from "react-router";
import remarkGfm from "remark-gfm";

import type { ObjectLink } from "@/api/types";
import { ImageLightbox } from "@/components/image-lightbox";
import { fileName, fileUrl } from "@/lib/files";
import { matchRanges } from "@/lib/search";
import { wikiLinks } from "@/lib/wiki-links";

interface MarkdownViewProps {
  text: string;
  /** The record's resolved links; absent in history, where syntax stays text. */
  links?: ObjectLink[];
  /** The space an internal link opens in. */
  spaceId?: string;
  /** A search query whose occurrences are marked and the first scrolled into view. */
  highlight?: string;
}

/** The minimal hast shape the highlight plugin walks; no dependency on the types. */
interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Markdown that is shown verbatim is not prose to mark. */
const SKIP_TAGS = new Set(["code", "pre"]);

/** The palette's marker, reused so search looks the same everywhere. */
const MARK_CLASSES = [
  "bg-transparent",
  "text-inherit",
  "underline",
  "decoration-accent",
  "decoration-2",
  "underline-offset-2",
];

/**
 * A rehype plugin that wraps query matches in `<mark>` text nodes. It walks the
 * rendered tree, so attribute values and code are never touched.
 */
function highlightMatches(query: string) {
  return () => (tree: unknown) => {
    const root = tree as HastNode;
    if (root.children) {
      root.children = splitChildren(root.children, query);
    }
  };
}

function splitChildren(children: HastNode[], query: string): HastNode[] {
  return children.flatMap((child) => {
    if (child.type === "text") {
      return markText(child.value ?? "", query);
    }
    if (
      (child.type === "element" || child.type === "root") &&
      !(child.tagName !== undefined && SKIP_TAGS.has(child.tagName)) &&
      child.children
    ) {
      child.children = splitChildren(child.children, query);
    }
    return [child];
  });
}

function markText(text: string, query: string): HastNode[] {
  const ranges = matchRanges(text, query);
  if (ranges.length === 0) {
    return [{ type: "text", value: text }];
  }
  const nodes: HastNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) {
      nodes.push({ type: "text", value: text.slice(cursor, start) });
    }
    nodes.push({
      type: "element",
      tagName: "mark",
      properties: { className: MARK_CLASSES, "data-search-match": "" },
      children: [{ type: "text", value: text.slice(start, end) }],
    });
    cursor = end;
  }
  if (cursor < text.length) {
    nodes.push({ type: "text", value: text.slice(cursor) });
  }
  return nodes;
}

/**
 * The body as prose: GFM via `remark-gfm`, every element mapped to the field
 * guide's type scale. Read mode never edits; the textarea owns writing.
 */
export function MarkdownView({ text, links, spaceId, highlight }: MarkdownViewProps) {
  const plugins = useMemo(() => {
    if (!links || !spaceId) {
      return [];
    }
    return [wikiLinks(new Map(links.map((link) => [link.raw, link])), spaceId)];
  }, [links, spaceId]);
  const query = highlight?.trim() ?? "";
  const highlightPlugins = useMemo(() => {
    if (query === "") {
      return [];
    }
    return [highlightMatches(query)];
  }, [query]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** The body's own images, at reading size, when the space can serve them. */
  const [preview, setPreview] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  /** The query this view already centred, so the same search does not fight a scroll. */
  const scrolledFor = useRef<string | null>(null);

  useEffect(() => {
    if (query === "" || scrolledFor.current === query) {
      return;
    }
    const mark = rootRef.current?.querySelector<HTMLElement>("[data-search-match]");
    if (!mark) {
      return;
    }
    scrolledFor.current = query;
    const relaxed =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    mark.scrollIntoView({ block: "center", behavior: relaxed ? "auto" : "smooth" });
  }, [query]);

  /**
   * The element map, kept stable while the space is: opening the lightbox
   * re-renders this view, and a fresh `img` identity would remount the button
   * whose node the dialog hands focus back to.
   */
  const components = useMemo<Components>(
    () => ({
      h1: ({ children }) => (
        <h1 className="mt-6 mb-2 text-[24px] font-medium tracking-[-0.02em] first:mt-0">
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 className="mt-6 mb-2 text-[19px] font-medium first:mt-0">{children}</h2>
      ),
      h3: ({ children }) => (
        <h3 className="mt-5 mb-1.5 text-[16px] font-medium first:mt-0">{children}</h3>
      ),
      p: ({ children }) => <p className="my-2.5">{children}</p>,
      ul: ({ children }) => <ul className="my-2.5 list-disc pl-5">{children}</ul>,
      ol: ({ children }) => <ol className="my-2.5 list-decimal pl-5">{children}</ol>,
      li: ({ children }) => <li className="my-1 pl-0.5">{children}</li>,
      a: ({ children, href, title }) => {
        if (href === "#broken") {
          return (
            <span
              title={title}
              className="cursor-help underline decoration-warning decoration-dotted underline-offset-2"
            >
              {children}
            </span>
          );
        }
        if (href?.startsWith("/s/")) {
          return (
            <Link
              to={href}
              className="text-accent underline decoration-line-strong hover:decoration-accent pointer-coarse:py-3.5"
            >
              {children}
            </Link>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline decoration-line-strong hover:decoration-accent pointer-coarse:py-3.5"
          >
            {children}
          </a>
        );
      },
      strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
      em: ({ children }) => <em className="italic">{children}</em>,
      blockquote: ({ children }) => (
        <blockquote className="my-3 border-l rule pl-4 text-muted">{children}</blockquote>
      ),
      hr: () => <hr className="my-6 border-t rule" />,
      pre: ({ children }) => (
        <pre className="my-3 overflow-x-auto rounded-[16px] border border-line bg-surface p-3 font-mono text-[12.5px] leading-[1.55] [&_code]:bg-transparent [&_code]:p-0">
          {children}
        </pre>
      ),
      code: ({ children }) => (
        <code className="rounded-[3px] bg-raised px-1 py-0.5 font-mono text-[12.5px]">
          {children}
        </code>
      ),
      table: ({ children }) => (
        <div className="my-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-[13px]">{children}</table>
        </div>
      ),
      th: ({ children }) => (
        <th className="label border-b rule py-1.5 pr-3 font-medium">{children}</th>
      ),
      td: ({ children }) => <td className="border-b rule py-1.5 pr-3 align-top">{children}</td>,
      img: ({ src, alt }) => {
        const picture = (
          <img
            src={src}
            alt={alt ?? ""}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="my-3 max-w-full rounded-field border border-line"
          />
        );
        // A body names stored bytes the same way frontmatter does; the
        // route, not the file system, serves them.
        if (!spaceId || typeof src !== "string" || !src.startsWith("files/")) {
          return picture;
        }
        const name = fileName(src);
        return (
          <button
            type="button"
            aria-label={`Open image ${name}`}
            className="block max-w-full rounded-field transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={(event) => {
              opener.current = event.currentTarget;
              setPreview(src);
            }}
          >
            <img
              src={fileUrl(spaceId, src)}
              alt={alt ?? ""}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="my-3 max-w-full rounded-field border border-line"
            />
          </button>
        );
      },
    }),
    [spaceId],
  );

  if (text.trim() === "") {
    return (
      <p className="py-10 text-[13px] text-faint">
        No body yet. Switch to Write and add some prose.
      </p>
    );
  }

  return (
    <div ref={rootRef} className="max-w-[68ch] py-2 text-[15px] leading-[1.65]">
      <Markdown
        remarkPlugins={[remarkGfm, ...plugins]}
        rehypePlugins={highlightPlugins}
        components={components}
      >
        {text}
      </Markdown>
      {preview && spaceId ? (
        <ImageLightbox
          spaceId={spaceId}
          images={[{ path: preview, title: fileName(preview) }]}
          index={0}
          onIndexChange={() => {}}
          returnFocus={opener}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
