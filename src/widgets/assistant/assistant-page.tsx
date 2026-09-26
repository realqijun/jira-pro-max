"use client";

import type { ChatStatus, UIMessage } from "ai";
import { MessageSquare, SquarePen } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  createConversationAction,
  deleteConversationAction,
  pinConversationAction,
  setConversationScopeAction,
} from "@/server/modules/assistant/actions";
import { Button } from "@/shared/ui";
import type { ConversationSummary } from "./assistant-dock";
import { ChatPanel } from "./chat-panel";
import { dropChat, ensureChat, makeChat } from "./chat-store";
import { ConversationList, ConversationMenu } from "./conversation-list";

/**
 * The full-page Assistant at /assistant/<id>: grouped history in a left sidebar (items are Links)
 * plus the current Conversation's ChatPanel. It shares the Chat registry with the dock, so a turn
 * started in the dock keeps streaming here - and the same chat can even be visible in both at once.
 * The page is keyed by conversation id, so each chat gets fresh state.
 */
export function AssistantPage({
  conversation,
  messages,
  conversations,
  projects,
  configured,
}: {
  conversation: { id: string; projectId: string | null };
  messages: UIMessage[];
  conversations: ConversationSummary[];
  projects: { id: string; name: string; key: string }[];
  configured: boolean;
}) {
  const router = useRouter();
  const [chat] = React.useState(() => ensureChat(conversation.id, () => makeChat(conversation.id, messages, router)));
  // A live registry Chat can hold newer Messages than the server-rendered thread (a turn that
  // finished mid-navigation), so the panel only mounts after hydration to avoid a mismatch.
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [status, setStatus] = React.useState<ChatStatus>("ready");
  const [menu, setMenu] = React.useState<{ x: number; y: number; c: ConversationSummary } | null>(null);
  const busy = status === "submitted" || status === "streaming";

  const newChat = async () => {
    const res = await createConversationAction({ projectId: conversation.projectId });
    if (!res.ok) return console.error(res.error);
    router.push(`/assistant/${res.data.id}`);
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
    if (c.id === conversation.id) {
      const next = conversations.find((x) => x.id !== c.id);
      router.push(next ? `/assistant/${next.id}` : "/");
    } else {
      router.refresh();
    }
  };
  const setScope = async (c: ConversationSummary, target: string | null) => {
    const res = await setConversationScopeAction({ conversationId: c.id, projectId: target });
    if (!res.ok) return console.error(res.error);
    router.refresh();
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-64 shrink-0 flex-col border-r border-hairline bg-surface-1">
        <div className="flex h-11 items-center gap-1 border-b border-hairline px-4">
          <MessageSquare className="size-3.5 shrink-0 text-primary" />
          <h2 className="text-body-sm font-medium text-ink">Assistant</h2>
          <div className="ml-auto">
            <Button size="icon" variant="ghost" onClick={() => void newChat()} aria-label="New chat">
              <SquarePen className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ConversationList
            conversations={conversations}
            projects={projects}
            activeId={conversation.id}
            busy={busy ? new Set([conversation.id]) : undefined}
            hrefFor={(id) => `/assistant/${id}`}
            onContextMenu={(e, c) => setMenu({ x: e.clientX, y: e.clientY, c })}
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4">
          {mounted ? (
            <ChatPanel chat={chat} projectId={conversation.projectId} configured={configured} onStatus={setStatus} />
          ) : (
            <div className="flex-1" />
          )}
        </div>
      </div>
      <ConversationMenu
        menu={menu}
        projects={projects}
        onClose={() => setMenu(null)}
        onPin={(c) => void pin(c)}
        onDelete={(c) => void remove(c)}
        onScope={(c, target) => void setScope(c, target)}
      />
    </div>
  );
}
