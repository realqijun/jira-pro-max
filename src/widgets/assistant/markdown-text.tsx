"use client";

import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { captureEvent } from "@/shared/analytics/browser";
import { CITATION_KINDS, internalHref } from "./linked-text";

/**
 * Markdown emitted by the Assistant. ReactMarkdown treats raw HTML as text unless the
 * rehype-raw plugin is added, which we intentionally do not enable.
 */
export function MarkdownText({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: SafeLink,
          p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
          h1: ({ children }) => <h1 className="mt-3 mb-1 text-body font-semibold text-ink first:mt-0">{children}</h1>,
          h2: ({ children }) => (
            <h2 className="mt-3 mb-1 text-body-sm font-semibold text-ink first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => <h3 className="mt-2 mb-1 text-body-sm font-medium text-ink first:mt-0">{children}</h3>,
          ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-1 border-l-2 border-hairline-strong pl-3 text-ink-subtle">{children}</blockquote>
          ),
          strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
          code: ({ children, className }) => (
            <code className={className ?? "rounded-sm bg-surface-3 px-1 py-0.5 font-mono text-caption text-ink"}>
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-md border border-hairline bg-canvas p-2 font-mono text-caption text-ink">
              {children}
            </pre>
          ),
          hr: () => <hr className="my-3 border-hairline" />,
          table: ({ children }) => <table className="my-2 w-full border-collapse text-caption">{children}</table>,
          th: ({ children }) => (
            <th className="border border-hairline bg-surface-2 px-2 py-1 text-left font-medium text-ink">{children}</th>
          ),
          td: ({ children }) => <td className="border border-hairline px-2 py-1 align-top">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function SafeLink({ href, children }: ComponentPropsWithoutRef<"a">) {
  const safeHref = href ? internalHref(href) : null;
  if (!safeHref) return <span>{children}</span>;
  return (
    <Link
      href={safeHref}
      onClick={() => captureEvent("assistant_citation_opened", { citation_kind: citationKind(safeHref) })}
      className="text-primary underline decoration-primary/40 hover:decoration-primary"
    >
      {children}
    </Link>
  );
}

/**
 * Which Project section a citation opens, from a closed set so model text never becomes a
 * property value. `other` is unreachable for a rendered link - `internalHref` rejects an
 * unknown section - and stays as the fallback for any caller that has not been through it.
 */
export function citationKind(href: string) {
  const section = new URL(href, "http://app.local").pathname.split("/").filter(Boolean)[2];
  if (!section) return "overview";
  return CITATION_KINDS.has(section) ? section : "other";
}
