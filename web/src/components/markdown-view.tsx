import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * The body as prose: GFM via `remark-gfm`, every element mapped to the field
 * guide's type scale. Read mode never edits; the textarea owns writing.
 */
export function MarkdownView({ text }: { text: string }) {
  if (text.trim() === "") {
    return (
      <p className="py-10 text-[13px] text-faint">
        No body yet. Switch to Write and add some prose.
      </p>
    );
  }

  return (
    <div className="max-w-[68ch] py-2 text-[15px] leading-[1.65]">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
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
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline decoration-line-strong hover:decoration-accent"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l rule pl-4 text-muted">{children}</blockquote>
          ),
          hr: () => <hr className="my-6 border-t rule" />,
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-field border border-line bg-surface p-3 font-mono text-[12.5px] leading-[1.55] [&_code]:bg-transparent [&_code]:p-0">
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
          img: ({ src, alt }) => (
            <img src={src} alt={alt ?? ""} className="my-3 max-w-full rounded-field border border-line" />
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
