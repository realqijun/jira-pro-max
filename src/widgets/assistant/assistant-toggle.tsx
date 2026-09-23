"use client";

import { Sparkles } from "lucide-react";
import { useShell } from "@/shared/lib/shell-context";
import { Button } from "@/shared/ui";

/** Header button that opens or closes the Assistant dock. */
export function AssistantToggle() {
  const { assistantOpen, toggleAssistant } = useShell();
  return (
    <Button
      size="sm"
      data-tour="assistant-toggle"
      variant={assistantOpen ? "secondary" : "ghost"}
      onClick={toggleAssistant}
      aria-pressed={assistantOpen}
    >
      <Sparkles className="size-3.5 text-primary" /> Assistant
    </Button>
  );
}
