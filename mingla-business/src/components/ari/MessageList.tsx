/**
 * ORCH-0821 — MessageList
 * Renders Ari messages in a FlatList. Auto-scrolls to bottom on new message.
 * Renders user bubbles, Ari prose bubbles, tool-result success ribbons, and
 * (when a pending action is live) a ToolProposalCard inline.
 */

import React, { useEffect, useRef } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius,
  semantic,
  spacing,
  typography,
} from "../../constants/designSystem";
import { AgentMessage } from "../../services/agentChatService";
import { ChatBubble } from "./ChatBubble";
import { ToolProposalCard } from "./ToolProposalCard";
import type { PendingActionView } from "../../hooks/useAgentChat";

export interface MessageListProps {
  messages: AgentMessage[];
  pendingAction: PendingActionView | null;
  isExecuting: boolean;
  onConfirm: (editedArgs?: Record<string, unknown>) => void;
  onCancel: () => void;
  isThinking?: boolean;
  renderThinking?: () => React.ReactNode;
}

type ListItem =
  | { kind: "message"; message: AgentMessage }
  | { kind: "pending"; pendingAction: PendingActionView }
  | { kind: "thinking" };

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  pendingAction,
  isExecuting,
  onConfirm,
  onCancel,
  isThinking = false,
  renderThinking,
}) => {
  const listRef = useRef<FlatList<ListItem>>(null);

  // Compose the rendered list. Two classes of rows are skipped entirely so
  // they don't leave empty separators in the FlatList:
  //   1. Historical proposal messages — assistant rows whose only content
  //      is a tool_call. The tool_result row tells the story (success
  //      ribbon or Cancelled pill), so rendering "(proposal)" is redundant.
  //   2. Failed tool_result rows — the top toast surfaces the failure copy
  //      and Ari's natural follow-up reply explains the recovery; a red
  //      inline ribbon would be the third indicator for one event.
  //      We keep the row in the DB (Gemini reads it for next-turn context)
  //      but hide it from the visual thread.
  const items: ListItem[] = [];
  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls && !(m.content as any)?.text) {
      const pendingId = (m.tool_calls as any).pending_action_id;
      if (pendingAction && pendingId === pendingAction.pending_action_id) {
        continue; // currently active — will render as live ToolProposalCard at tail
      }
      continue; // historical proposal — silent
    }
    if (m.role === "tool" && (m.tool_results as any)?.outcome === "failed") {
      continue; // hidden — toast + Ari follow-up cover this
    }
    items.push({ kind: "message", message: m });
  }
  if (pendingAction) items.push({ kind: "pending", pendingAction });
  if (isThinking) items.push({ kind: "thinking" });

  useEffect(() => {
    if (items.length === 0) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, [items.length, pendingAction?.pending_action_id, isThinking]);

  return (
    <FlatList
      ref={listRef}
      data={items}
      keyExtractor={(item, idx) => {
        if (item.kind === "message") return `m-${item.message.id}`;
        if (item.kind === "pending") return `p-${item.pendingAction.pending_action_id}`;
        return `t-${idx}`;
      }}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => {
        if (item.kind === "thinking") {
          return <View>{renderThinking?.()}</View>;
        }
        if (item.kind === "pending") {
          return (
            <ToolProposalCard
              toolName={item.pendingAction.tool_name}
              args={item.pendingAction.tool_args}
              isExecuting={isExecuting}
              onConfirm={onConfirm}
              onCancel={onCancel}
            />
          );
        }
        const m = item.message;
        if (m.role === "tool") {
          return renderToolResult(m);
        }
        const text = (m.content as any)?.text ?? "";
        if (!text) return null; // empty rows shouldn't render an empty bubble
        return <ChatBubble role={m.role === "user" ? "user" : "assistant"} text={text} />;
      }}
    />
  );
};

function renderToolResult(m: AgentMessage): React.ReactElement | null {
  const tr = m.tool_results as any;
  const outcome = tr?.outcome ?? "executed";

  // Failures are surfaced via the top toast AND Ari's natural follow-up
  // reply that explains the recovery. The inline red ribbon was a third,
  // redundant indicator that leaked raw error codes into the chat thread.
  // Keep the tool_result row in the DB (Gemini reads it on the next turn
  // for context) but don't render it in the UI.
  if (outcome === "failed") return null;

  if (outcome === "cancelled") {
    return (
      <View style={styles.cancelledRibbon}>
        <Text style={styles.cancelledText}>Cancelled</Text>
      </View>
    );
  }
  // executed — derive a short label
  let label = "Done";
  const r = tr?.result;
  if (tr?.tool_name === "create_brand" && r?.brand?.name) {
    label = `Created brand "${r.brand.name}"`;
  } else if (tr?.tool_name === "create_event" && r?.event?.title) {
    label = `Created "${r.event.title}"`;
  } else if (tr?.tool_name === "update_event") {
    label = "Updated event";
  }
  return (
    <View style={styles.successRibbon} accessibilityRole="text" accessibilityLabel={label}>
      <Text style={styles.successText}>✓ {label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    paddingBottom: spacing.xxl,
  },
  sep: {
    // Tighter than spacing.md (16) — premium chat surfaces use ~10pt
    // between messages so the conversation reads as one continuous flow.
    height: 10,
  },
  successRibbon: {
    alignSelf: "flex-start",
    backgroundColor: semantic.successTint,
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.4)",
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  successText: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: semantic.success,
  },
  cancelledRibbon: {
    alignSelf: "flex-start",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  cancelledText: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.7)",
  },
  // failedRibbon/failedText removed — failed tool outcomes are surfaced via
  // the top Toast + Ari's follow-up reply instead of an inline ribbon.
});

export default MessageList;
