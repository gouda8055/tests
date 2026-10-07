import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Renders untrusted, user-authored markdown (lessons, questions,
 * explanations). react-markdown maps its own parsed AST to a fixed set of
 * React elements and, without rehype-raw (deliberately not installed),
 * never renders embedded raw HTML — so there is no dangerouslySetInnerHTML
 * path here at all (SECURITY.md §5). Links and images are additionally
 * restricted to absolute http(s) URLs, so a `javascript:`/`data:` URL
 * smuggled through markdown syntax renders as inert text.
 */

function safeHttpUrl(value: unknown, allowHttp = true): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || (allowHttp && url.protocol === "http:")) {
      return url.toString();
    }
  } catch {
    // Relative or malformed URL — rejected.
  }
  return null;
}

const components: Components = {
  a({ href, children }) {
    const safe = safeHttpUrl(href);
    if (!safe) return <span>{children}</span>;
    return (
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-4"
      >
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    const safe = safeHttpUrl(src, false);
    if (!safe) return null;
    return (
      // Author-supplied external hosts aren't known at build time, so
      // next/image's remote-pattern allowlist doesn't fit here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={safe}
        alt={alt ?? ""}
        referrerPolicy="no-referrer"
        loading="lazy"
        className="my-4 max-w-full rounded-md"
      />
    );
  },
  h1: ({ children }) => <h1 className="mt-6 mb-3 text-2xl font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-6 mb-3 text-xl font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-4 mb-2 text-lg font-semibold">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-4 mb-2 font-semibold">{children}</h4>,
  p: ({ children }) => <p className="my-3 leading-7">{children}</p>,
  ul: ({ children }) => <ul className="my-3 ml-6 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 ml-6 list-decimal space-y-1">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="text-muted-foreground my-3 border-l-2 pl-4 italic">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="bg-muted rounded px-1 py-0.5 font-mono text-sm">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="bg-muted my-3 overflow-x-auto rounded-md p-4 text-sm [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border px-2 py-1 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border px-2 py-1">{children}</td>,
  hr: () => <hr className="my-6" />,
};

export function Markdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div data-slot="markdown" className={cn("text-sm break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
