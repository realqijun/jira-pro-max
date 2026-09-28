"use client";

import { useChat, type Chat } from "@ai-sdk/react";
import { getToolName, isToolUIPart, type ChatStatus, type UIMessage } from "ai";
import { ArrowUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { grantToolPermissionAction } from "@/server/modules/assistant/actions";
import {
  ASSISTANT_ERROR_TEXT,
  ASSISTANT_NOT_CONFIGURED,
  TURN_ERROR_PART,
  type TurnErrorData,
} from "@/shared/lib/assistant-errors";
import { cn } from "@/shared/lib/cn";
import { Button, Panel, SectionTitle, Textarea } from "@/shared/ui";
import { LinkedText } from "./linked-text";
import { MarkdownText } from "./markdown-text";
import { ToolCall } from "./tool-call";

const isPendingCard = (part: UIMessage["parts"][number]) => isToolUIPart(part) && part.state === "approval-requested";
const isTurnError = (part: UIMessage["parts"][number]) => part.type === TURN_ERROR_PART;
/** A reply that died before it produced anything leaves an empty bubble; skip it. */
const isEmpty = (m: UIMessage) => m.parts.every((p) => p.type === "step-start");
const noticeClass = "rounded-md bg-surface-2 px-3 py-2 text-caption text-ink-subtle";

type ProjectSummary = {
  project?: { name?: string; key?: string } | null;
  milestones?: { name?: string; targetDate?: string }[];
  tasks?: { number?: number; title?: string; status?: string }[];
  risks?: { name?: string }[];
};

function latestSummary(messages: UIMessage[]): ProjectSummary | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    for (let j = m.parts.length - 1; j >= 0; j--) {
      const part = m.parts[j];
      if (!isToolUIPart(part) || part.state !== "output-available") continue;
      const name = getToolName(part);
      if (name === "get_project_summary" && part.output && typeof part.output === "object") {
        return part.output as ProjectSummary;
      }
      if (name === "list_projects" && Array.isArray(part.output)) {
        return {
          project: null,
          milestones: [],
          tasks: part.output as unknown as { number: number; title: string; status: string }[],
          risks: [],
        };
      }
    }
  }
  return null;
}

function CurrentState({ messages }: { messages: UIMessage[] }) {
  const summary = latestSummary(messages);
  if (!summary) return null;
  const milestones = summary.milestones ?? [];
  const tasks = summary.tasks ?? [];
  const risks = summary.risks ?? [];
  return (
    <Panel className="mb-3 p-3">
      <SectionTitle className="mb-2">Current state</SectionTitle>
      {summary.project && summary.project.name && (
        <p className="mb-2 truncate text-body-sm font-medium text-ink">
          {summary.project.key ? `${summary.project.key} · ` : ""}
          {summary.project.name}
        </p>
      )}
      {milestones.length > 0 && (
        <div className="mb-2">
          <p className="text-caption text-ink-subtle">Milestones</p>
          <ul className="mt-1 space-y-0.5">
            {milestones.map((m, i) => (
              <li key={i} className="truncate text-caption text-ink-subtle">
                {m.targetDate ? `${m.targetDate} · ` : ""}
                {m.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      {tasks.length > 0 && (
        <div className="mb-2">
          <p className="text-caption text-ink-subtle">Tasks</p>
          <ul className="mt-1 space-y-0.5">
            {tasks.slice(0, 8).map((t, i) => (
              <li key={i} className="truncate text-caption text-ink-subtle">
                {t.number ? `#${t.number} ` : ""}
                {t.title}
                {t.status ? <span className="text-ink-faint"> · {t.status}</span> : null}
              </li>
            ))}
            {tasks.length > 8 && <li className="text-ink-faint text-caption">+{tasks.length - 8} more</li>}
          </ul>
        </div>
      )}
      {risks.length > 0 && <p className="text-caption text-ink-subtle">Risks: {risks.length}</p>}
    </Panel>
  );
}

/**
 * One Conversation's chat surface: messages, streaming, approvals, composer. The Chat instance is
 * owned by the module-level registry (chat-store), so the panel can unmount - hidden behind
 * another chat or a closed dock - without killing a turn in flight.
 */
export function ChatPanel({
  chat,
  projectId,
  configured,
  onStatus,
}: {
  /** Persistent Chat from the registry; survives this panel's unmounts. */
  chat: Chat<UIMessage>;
  /** The Conversation's own scope - drives permission grants and the empty-state hint. */
  projectId: string | null;
  configured: boolean;
  /** Reports the ChatStatus on mount and every change, for list spinners. */
  onStatus?: (status: ChatStatus) => void;
}) {
  const router = useRouter();
  const [input, setInput] = React.useState("");
  const { messages, sendMessage, addToolApprovalResponse, status, error } = useChat({ chat });
  const busy = status === "submitted" || status === "streaming";
  // A confirm card must be answered before the next message; a refresh brings the card back.
  const pendingCard = messages.at(-1)?.parts.some(isPendingCard) ?? false;
  const bottom = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  React.useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  const submit = () => {
    const text = input.trim();
    if (!text || busy || pendingCard) return;
    void sendMessage({ text });
    setInput("");
  };
  // Grant first so the resumed turn (auto-sent on response) already sees the permission.
  const alwaysAllow = async (approvalId: string, toolName: string) => {
    const res = await grantToolPermissionAction({ projectId, toolName });
    if (!res.ok) console.error(res.error);
    router.refresh();
    void addToolApprovalResponse({ id: approvalId, approved: true });
  };
  // A failed reply carries its error as a part; the notice covers failures before any reply.
  const errorShownInThread = messages.at(-1)?.parts.some(isTurnError) ?? false;
  const notice = !configured
    ? ASSISTANT_ERROR_TEXT[ASSISTANT_NOT_CONFIGURED]
    : error && !errorShownInThread
      ? friendly(error)
      : null;

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && !notice && (
          <p className="py-6 text-center text-caption text-ink-subtle">
            {projectId
              ? "Ask for a plan, a summary, or a change. Try “plan a two-month launch with UAT in week 6”."
              : "Start from nothing. Try “create a project called Website Relaunch, key WEB”."}
          </p>
        )}
        <CurrentState messages={messages} />
        <ol className="flex flex-col gap-3">
          {messages
            .filter((m) => !isEmpty(m))
            .map((m) => (
              <li key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-body-sm",
                    m.role === "user" ? "bg-surface-3 text-ink" : "text-ink-muted",
                  )}
                >
                  {m.parts.map((part, i) => (
                    <Part
                      key={i}
                      part={part}
                      isAssistant={m.role === "assistant"}
                      onAnswer={(id, approved) => void addToolApprovalResponse({ id, approved })}
                      onAlwaysAllow={alwaysAllow}
                    />
                  ))}
                </div>
              </li>
            ))}
        </ol>
        {busy && (
          <p role="status" className="mt-3 flex items-center gap-2 text-caption text-ink-subtle">
            <Loader2 className="size-3 animate-spin" /> Working…
          </p>
        )}
        {notice && (
          <p role="status" className={cn("mt-3", noticeClass)}>
            {notice}
          </p>
        )}
        <div ref={bottom} />
      </div>
      <form
        className="flex items-end gap-2 border-t border-hairline p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            !configured
              ? "Assistant not configured"
              : pendingCard
                ? "Answer the card above first"
                : "Message the Assistant…"
          }
          disabled={!configured || pendingCard}
          rows={2}
          className="min-h-0 resize-none"
          aria-label="Message"
        />
        <Button
          type="submit"
          size="icon"
          variant="primary"
          disabled={!configured || busy || pendingCard || !input.trim()}
        >
          <ArrowUp className="size-3.5" />
        </Button>
      </form>
    </>
  );
}

function friendly(error: Error) {
  return ASSISTANT_ERROR_TEXT[error.message] ?? "Something went wrong. Try again.";
}

function Part({
  part,
  isAssistant,
  onAnswer,
  onAlwaysAllow,
}: {
  part: UIMessage["parts"][number];
  isAssistant: boolean;
  onAnswer: (approvalId: string, approved: boolean) => void;
  onAlwaysAllow: (approvalId: string, toolName: string) => Promise<void>;
}) {
  if (part.type === "text") return isAssistant ? <MarkdownText text={part.text} /> : <LinkedText text={part.text} />;
  if (part.type === TURN_ERROR_PART)
    return (
      <p role="status" className={cn("my-1", noticeClass)}>
        {(part.data as TurnErrorData).message}
      </p>
    );
  if (!isToolUIPart(part)) return null;
  return <ToolCall part={part} onAnswer={onAnswer} onAlwaysAllow={onAlwaysAllow} />;
}
