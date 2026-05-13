/**
 * ORCH-0821 — ConversationDrawer
 * Sheet-based list of past Ari conversations.
 *
 * Behaviors:
 *   - Tap row → open that conversation
 *   - Long-press row → delete (single, with confirm)
 *   - "Select" mode toggle → tap rows to multi-select, then Delete N
 *   - ScrollView wrapper so long lists are scrollable
 *   - Optimistic delete: rows vanish synchronously, then we invalidate
 *     React Query to reconcile with the server. Avoids the "I deleted
 *     it but it's still there" feel from waiting on the round trip.
 */

import React, { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import {
  ariPalette,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Sheet } from "../ui/Sheet";
import {
  deleteConversation,
  type AgentConversation,
} from "../../services/agentChatService";
import { agentQueryKeys } from "../../hooks/useAgentChat";

export interface ConversationDrawerProps {
  visible: boolean;
  onClose: () => void;
  conversations: AgentConversation[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
}

export const ConversationDrawer: React.FC<ConversationDrawerProps> = ({
  visible,
  onClose,
  conversations,
  activeId,
  onSelect,
}) => {
  const qc = useQueryClient();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset select state every time the drawer closes
  React.useEffect(() => {
    if (!visible) {
      setSelectMode(false);
      setSelectedIds(new Set());
    }
  }, [visible]);

  const toggleSelect = useCallback((id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const optimisticDelete = useCallback(
    (ids: string[]): void => {
      // Remove rows from the cache synchronously so the UI reflects the
      // deletion immediately. The subsequent invalidate triggers a refetch
      // that reconciles with the server.
      qc.setQueryData<AgentConversation[]>(
        agentQueryKeys.conversations(),
        (prev) => (prev ? prev.filter((c) => !ids.includes(c.id)) : prev),
      );
    },
    [qc],
  );

  const handleLongPressSingle = useCallback(
    (c: AgentConversation): void => {
      if (selectMode) {
        toggleSelect(c.id);
        return;
      }
      Alert.alert(
        c.title ?? "Untitled conversation",
        "Delete this conversation? This can't be undone.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              optimisticDelete([c.id]);
              try {
                await deleteConversation(c.id);
              } catch (err) {
                // Roll back optimistic removal by refetching the truth.
                qc.invalidateQueries({ queryKey: agentQueryKeys.conversations() });
                Alert.alert(
                  "Couldn't delete",
                  err instanceof Error ? err.message : "Unknown error",
                );
                return;
              }
              qc.invalidateQueries({ queryKey: agentQueryKeys.conversations() });
              if (c.id === activeId) {
                qc.invalidateQueries({ queryKey: agentQueryKeys.messages(c.id) });
                onSelect(null);
              }
            },
          },
        ],
      );
    },
    [activeId, onSelect, optimisticDelete, qc, selectMode, toggleSelect],
  );

  const handleBulkDelete = useCallback((): void => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    Alert.alert(
      `Delete ${ids.length} ${ids.length === 1 ? "conversation" : "conversations"}?`,
      "This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            optimisticDelete(ids);
            const deletedActive = activeId !== null && ids.includes(activeId);
            // Fire all deletions in parallel
            const results = await Promise.allSettled(
              ids.map((id) => deleteConversation(id)),
            );
            const failed = results.filter((r) => r.status === "rejected");
            qc.invalidateQueries({ queryKey: agentQueryKeys.conversations() });
            if (deletedActive) {
              qc.invalidateQueries({ queryKey: agentQueryKeys.messages(activeId) });
              onSelect(null);
            }
            setSelectMode(false);
            setSelectedIds(new Set());
            if (failed.length > 0) {
              Alert.alert(
                "Some deletions failed",
                `${failed.length} of ${ids.length} couldn't be deleted. The list has been refreshed.`,
              );
            }
          },
        },
      ],
    );
  }, [activeId, onSelect, optimisticDelete, qc, selectedIds]);

  const handleRowPress = useCallback(
    (c: AgentConversation): void => {
      if (selectMode) {
        toggleSelect(c.id);
        return;
      }
      onSelect(c.id);
      onClose();
    },
    [onClose, onSelect, selectMode, toggleSelect],
  );

  const headerRight = conversations.length > 0
    ? selectMode
      ? (
        <Pressable
          onPress={() => {
            setSelectMode(false);
            setSelectedIds(new Set());
          }}
          accessibilityRole="button"
          accessibilityLabel="Exit select mode"
          hitSlop={8}
        >
          <Text style={styles.headerAction}>Done</Text>
        </Pressable>
      )
      : (
        <Pressable
          onPress={() => setSelectMode(true)}
          accessibilityRole="button"
          accessibilityLabel="Select multiple conversations to delete"
          hitSlop={8}
        >
          <Text style={styles.headerAction}>Select</Text>
        </Pressable>
      )
    : null;

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <View style={styles.host}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Conversations</Text>
          {headerRight}
        </View>

        {!selectMode ? (
          <Pressable
            onPress={() => {
              onSelect(null);
              onClose();
            }}
            style={({ pressed }) => [styles.newBtn, pressed && styles.btnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Start a new conversation"
          >
            <Text style={styles.newBtnText}>＋ New conversation</Text>
          </Pressable>
        ) : null}

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
        >
          {conversations.length === 0 ? (
            <Text style={styles.emptyHint}>No past conversations yet.</Text>
          ) : (
            conversations.map((c) => {
              const isActive = c.id === activeId;
              const isSelected = selectedIds.has(c.id);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => handleRowPress(c)}
                  onLongPress={() => handleLongPressSingle(c)}
                  delayLongPress={400}
                  style={({ pressed }) => [
                    styles.row,
                    isActive && !selectMode && styles.rowActive,
                    isSelected && styles.rowSelected,
                    pressed && styles.btnPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={c.title ?? `Conversation from ${new Date(c.updated_at).toLocaleDateString()}`}
                  accessibilityHint={selectMode ? "Tap to toggle selection" : "Tap to open; long-press to delete"}
                  accessibilityState={{ selected: selectMode ? isSelected : isActive }}
                >
                  {selectMode ? (
                    <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
                      {isSelected ? <Text style={styles.checkboxTick}>✓</Text> : null}
                    </View>
                  ) : null}
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {c.title ?? "Untitled conversation"}
                  </Text>
                  <Text style={styles.rowDate}>
                    {new Date(c.updated_at).toLocaleDateString()}
                  </Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        {selectMode ? (
          <View style={styles.bulkBar}>
            <Text style={styles.bulkCount}>
              {selectedIds.size} selected
            </Text>
            <Pressable
              onPress={handleBulkDelete}
              disabled={selectedIds.size === 0}
              style={({ pressed }) => [
                styles.bulkDeleteBtn,
                selectedIds.size === 0 && styles.btnDisabled,
                pressed && selectedIds.size > 0 && styles.btnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${selectedIds.size} conversations`}
              accessibilityState={{ disabled: selectedIds.size === 0 }}
            >
              <Text style={styles.bulkDeleteText}>
                Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    minHeight: 32,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.2,
  },
  headerAction: {
    fontSize: 14,
    fontWeight: "600",
    color: ariPalette.flame,
    letterSpacing: -0.1,
  },
  newBtn: {
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    backgroundColor: glass.tint.profileElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    minHeight: 44,
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  newBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    gap: 4,
    paddingBottom: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    minHeight: 44,
    gap: spacing.sm,
  },
  rowActive: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  rowSelected: {
    backgroundColor: "rgba(230, 152, 105, 0.10)", // ariPalette.flame at 10%
    borderWidth: 1,
    borderColor: ariPalette.proposalBorder,
  },
  rowTitle: {
    flex: 1,
    fontSize: 14,
    color: textTokens.primary,
    letterSpacing: -0.1,
  },
  rowDate: {
    fontSize: 12,
    color: textTokens.tertiary,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: textTokens.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    backgroundColor: ariPalette.flame,
    borderColor: ariPalette.flame,
  },
  checkboxTick: {
    fontSize: 12,
    fontWeight: "700",
    color: textTokens.inverse,
    lineHeight: 14,
  },
  emptyHint: {
    fontSize: 13,
    color: textTokens.tertiary,
    paddingVertical: spacing.md,
    textAlign: "center",
  },
  bulkBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
    gap: spacing.md,
  },
  bulkCount: {
    fontSize: 13,
    color: textTokens.secondary,
    letterSpacing: -0.1,
  },
  bulkDeleteBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: semantic.errorTint,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.5)",
    minHeight: 36,
    justifyContent: "center",
  },
  bulkDeleteText: {
    fontSize: 13,
    fontWeight: "600",
    color: semantic.error,
    letterSpacing: -0.1,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnDisabled: {
    opacity: 0.4,
  },
});

export default ConversationDrawer;
