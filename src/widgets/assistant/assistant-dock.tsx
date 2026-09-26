"use client";

import type { ChatStatus, UIMessage } from "ai";
import { History, MessageSquare, SquarePen, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  createConversationAction,
  deleteConversationAction,
  loadConversationAction,
  pinConversationAction,
  setConversationScopeAction,
} from "@/server/modules/assistant/actions";
import { cn } from "@/shared/lib/cn";
import { useShell } from "@/shared/lib/shell-context";
import { Button } from "@/shared/ui";
import { ChatPanel } from "./chat-panel";
import { dropChat, ensureChat, getChat, makeChat } from "./chat-store";
import { ConversationList, ConversationMenu } from "./conversation-list";

export type ConversationSummary = {
  id: string;
  title: string | null;
  pinned: boolean;
  updatedAt: Date;
  /** The Conversation's scope: a Project id, or null for the dashboard ("Overall"). */
  projectId: string | null;
};
export type AssistantThread = { conversation: { id: string }; messages: UIMessage[] };

/**
 * Right-side Assistant panel for one Project, or for the dashboard when `projectId` is null
 * (ADR 0007). The history list groups ALL of the User's Conversations by scope; every chat opened
 * this session keeps a mounted (maybe hidden) ChatPanel backed by a registry Chat, so several
 * turns can stream in parallel while the user switches chats, closes the dock, or navigates.
 */
export function AssistantDock({
  projectId,
  projects,
  conversations,
  thread,
  configured,
}: {
  projectId: string | null;
  /** All of the User's Projects - targets for the per-chat access control and list groups. */
  projects: { id: string; name: string; key: string }[];
  /** The User's Conversations across every scope, pinned first then newest. */
  conversations: ConversationSummary[];
  /** The Conversation opened on mount (the latest in this scope) with its Messages. */
  thread: AssistantThread;
  configured: boolean;
}) {
  const { assistantOpen, toggleAssistant } = useShell();
  const router = useRouter();
  const [openIds, setOpenIds] = React.useState<string[]>(() => {
    ensureChat(thread.conversation.id, () => makeChat(thread.conversation.id, thread.messages, router));
    return [thread.conversation.id];
  });
  const [activeId, setActiveId] = React.useState(thread.conversation.id);
  const [showHistory, setShowHistory] = React.useState(false);
  const [busyIds, setBusyIds] = React.useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = React.useState<{ x: number; y: number; c: ConversationSummary } | null>(null);

  const markBusy = React.useCallback((id: string, s: ChatStatus) => {
    setBusyIds((prev) => {
      const busy = s === "submitted" || s === "streaming";
      if (prev.has(id) === busy) return prev;
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  if (!assistantOpen) return null;

  const activeTitle = conversations.find((c) => c.id === activeId)?.title ?? "New chat";
  /** A panel's scope is its own Conversation's; a just-created chat inherits the page scope. */
  const scopeFor = (id: string) => {
    const c = conversations.find((x) => x.id === id);
    return c ? c.projectId : projectId;
  };

  const newChat = async () => {
    setShowHistory(false);
    if (getChat(activeId)?.messages.length === 0) return; // already on a fresh chat
    const res = await createConversationAction({ projectId });
    if (!res.ok) return console.error(res.error);
    ensureChat(res.data.id, () => makeChat(res.data.id, [], router));
    setOpenIds((ids) => [...ids, res.data.id]);
    setActiveId(res.data.id);
    router.refresh();
  };
  /** Open any chat in place, regardless of scope; a live registry Chat is reused as-is. */
  const openChat = async (c: ConversationSummary) => {
    setShowHistory(false);
    if (!openIds.includes(c.id)) {
      const res = await loadConversationAction({ conversationId: c.id });
      if (!res.ok) return console.error(res.error);
      ensureChat(c.id, () => makeChat(c.id, res.data.messages, router));
      setOpenIds((ids) => [...ids, c.id]);
    }
    setActiveId(c.id);
  };
  const pin = async (c: ConversationSummary) => {
    const res = await pinConversationAction({ conversationId: c.id, pinned: !c.pinned });
    if (!res.ok) console.error(res.error);
    router.refresh();
  };
  const remove = async (c: ConversationSummary) => {
    const res = await deleteConversationAction({ conversationId: c.id });
    if (!res.ok) return console.error(res.error);
    dropChat(c.id);
    const remaining = openIds.filter((id) => id !== c.id);
    if (c.id === activeId && remaining.length === 0) {
      const n = await createConversationAction({ projectId });
      if (n.ok) {
        ensureChat(n.data.id, () => makeChat(n.data.id, [], router));
        remaining.push(n.data.id);
      }
    }
    setOpenIds(remaining);
    if (c.id === activeId && remaining.length) setActiveId(remaining.at(-1)!);
    router.refresh();
  };
  /** Re-scope a chat; the grouped list re-groups in place on refresh - no navigation needed. */
  const setScope = async (c: ConversationSummary, target: string | null) => {
    const res = await setConversationScopeAction({ conversationId: c.id, projectId: target });
    if (!res.ok) return console.error(res.error);
    router.refresh();
  };

  return (
    <aside aria-label="Assistant" className="flex shrink-0 border-l border-hairline bg-surface-1">
      {showHistory && (
        <div className="w-56 shrink-0 overflow-y-auto border-r border-hairline">
          <ConversationList
            conversations={conversations}
            projects={projects}
            activeId={activeId}
            busy={busyIds}
            onOpen={(c) => void openChat(c)}
            onContextMenu={(e, c) => setMenu({ x: e.clientX, y: e.clientY, c })}
          />
        </div>
      )}
      <div className="flex w-96 flex-col">
        <div className="flex h-11 items-center gap-1 border-b border-hairline px-4">
          <MessageSquare className="size-3.5 shrink-0 text-primary" />
          <h2 className="text-body-sm font-medium text-ink">Assistant</h2>
          <span className="text-ink-faint min-w-0 truncate text-caption" title={activeTitle}>
            {activeTitle}
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            <Button size="icon" variant="ghost" onClick={() => void newChat()} aria-label="New chat">
              <SquarePen className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setShowHistory((s) => !s)}
              aria-label="Chat history"
              aria-expanded={showHistory}
            >
              <History className="size-3.5" />
            </Button>
            <Button size="icon" variant="ghost" onClick={toggleAssistant} aria-label="Close Assistant">
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
        {openIds.map((id) => {
          const chat = getChat(id);
          if (!chat) return null;
          return (
            <div key={id} className={cn("flex min-h-0 flex-1 flex-col", id !== activeId && "hidden")}>
              <ChatPanel
                chat={chat}
                projectId={scopeFor(id)}
                configured={configured}
                onStatus={(s) => markBusy(id, s)}
              />
            </div>
          );
        })}
      </div>
      <ConversationMenu
        menu={menu}
        projects={projects}
        onClose={() => setMenu(null)}
        onPin={(c) => void pin(c)}
        onDelete={(c) => void remove(c)}
        onScope={(c, target) => void setScope(c, target)}
      />
    </aside>
  );
}
