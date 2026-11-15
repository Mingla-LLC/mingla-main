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
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AlertTriangle, Ellipsis } from "lucide-react-native";
import { AriOrb } from "./AriOrb";
import { useQueryClient } from "@tanstack/react-query";

import { ariPalette, color, radius, space } from "../../constants/designSystem";

/** #4420 — the desktop conversations pane width (mockup ari-chat__conversation-drawer). */
export const ariConversationPaneWidth = 320;
import { Sheet } from "../ui/Sheet";
// ORCH-0892: a file that hosts a TextInput scrolls through the keyboard-aware
// wrapper (KeyboardAwareScrollView on native, ScrollView on web).
import { ScrollView } from "../../wrappers/SmartScrollView";
import {
  deleteConversation,
  regenerateAgentConversationTitle,
  renameAgentConversation,
  type AgentConversation,
} from "../../services/agentChatService";
import { agentQueryKeys } from "../../hooks/agentQueryKeys";
import { captureAriTitleAction } from "../../services/ariPolishAnalytics";

/**
 * D-9: ConfirmDialog (web-capable, unlike Alert) loads only when a dialog opens.
 * Its animation stack must stay out of this drawer's import graph, which the
 * #2013 containment suite mounts without a native animation runtime.
 */
const ConfirmDialog = React.lazy(() =>
  import("../ui/ConfirmDialog").then((module) => ({ default: module.ConfirmDialog }))
);

export function conversationDisplayTitle(conversation: AgentConversation): string {
  const title = conversation.title?.trim();
  const fallback = `Conversation · ${new Date(conversation.updated_at).toLocaleDateString()}`;
  // P3-1: the legacy backfill stores the bare word "Conversation"; show the
  // same dated fallback an untitled conversation gets.
  if (conversation.title_source === "legacy_fallback" && title === "Conversation") return fallback;
  if (title && title.toLowerCase() !== "untitled conversation") return title;
  return fallback;
}

function friendlyDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const value = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((start - value) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export interface ConversationDrawerProps {
  visible: boolean;
  onClose: () => void;
  conversations: AgentConversation[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  selectedBrandName: string;
  hasSelectedBrand: boolean;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  surface?: "main" | "website";
  /**
   * #4420 — "sheet" (default): the list opens in a sheet (phone, narrow web).
   * "pane": wide desktop keeps the list open as a side pane beside the chat
   * (mockup ari-chat__conversation-drawer); opening a chat does not close it.
   */
  presentation?: "sheet" | "pane";
}

export const ConversationDrawer: React.FC<ConversationDrawerProps> = ({
  visible,
  onClose,
  conversations,
  activeId,
  onSelect,
  selectedBrandName,
  hasSelectedBrand,
  isLoading,
  isError,
  onRetry,
  surface = "main",
  presentation = "sheet",
}) => {
  const asPane = presentation === "pane";
  const qc = useQueryClient();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [menuConversation, setMenuConversation] = useState<AgentConversation | null>(null);
  const [renameConversation, setRenameConversation] = useState<AgentConversation | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  // D-9: web-capable confirmations and inline notices (Alert is a no-op on web).
  const [regenerateConfirm, setRegenerateConfirm] = useState<AgentConversation | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<AgentConversation | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState<string[] | null>(null);
  const [drawerNotice, setDrawerNotice] = useState<string | null>(null);
  const [menuNotice, setMenuNotice] = useState<string | null>(null);
  const [renameNotice, setRenameNotice] = useState<string | null>(null);

  // Reset select state every time the drawer closes
  React.useEffect(() => {
    if (!visible) {
      setSelectMode(false);
      setSelectedIds(new Set());
      setMenuConversation(null);
      setRenameConversation(null);
      setRegenerateConfirm(null);
      setDeleteConfirm(null);
      setBulkDeleteConfirm(null);
      setDrawerNotice(null);
      setMenuNotice(null);
      setRenameNotice(null);
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
      qc.setQueriesData<AgentConversation[]>(
        { queryKey: agentQueryKeys.conversationsRoot() },
        (prev) => (prev ? prev.filter((c) => !ids.includes(c.id)) : prev),
      );
    },
    [qc],
  );

  const handleDeleteSingle = useCallback(
    (c: AgentConversation): void => {
      if (selectMode) {
        toggleSelect(c.id);
        return;
      }
      setMenuNotice(null);
      setDeleteConfirm(c);
    },
    [selectMode, toggleSelect],
  );

  const confirmDeleteSingle = useCallback(async (): Promise<void> => {
    const c = deleteConfirm;
    if (!c) return;
    setDeleteConfirm(null);
    setMenuConversation(null);
    setDrawerNotice(null);
    optimisticDelete([c.id]);
    try {
      await deleteConversation(c.id);
    } catch {
      // Roll back optimistic removal by refetching the truth.
      qc.invalidateQueries({ queryKey: agentQueryKeys.conversationsRoot() });
      setDrawerNotice("Couldn’t delete that conversation. Check your connection and try again.");
      return;
    }
    qc.invalidateQueries({ queryKey: agentQueryKeys.conversationsRoot() });
    captureAriTitleAction(surface, "deleted");
    if (c.id === activeId) {
      qc.invalidateQueries({ queryKey: agentQueryKeys.messages(c.id) });
      onSelect(null);
    }
  }, [activeId, deleteConfirm, onSelect, optimisticDelete, qc, surface]);

  const regenerateTitle = useCallback(async (c: AgentConversation, confirmed = false): Promise<void> => {
    setRegeneratingId(c.id);
    setMenuNotice(null);
    try {
      await regenerateAgentConversationTitle(c.id, confirmed);
      captureAriTitleAction(surface, "regenerated");
      await qc.invalidateQueries({ queryKey: agentQueryKeys.conversationsRoot() });
      setMenuConversation(null);
    } catch {
      setMenuNotice("Couldn’t update the title. Your previous title is unchanged.");
    } finally {
      setRegeneratingId(null);
    }
  }, [qc, surface]);

  const handleRegenerate = useCallback((c: AgentConversation): void => {
    if (c.title_source === "manual") {
      setMenuNotice(null);
      setRegenerateConfirm(c);
      return;
    }
    void regenerateTitle(c);
  }, [regenerateTitle]);

  const handleBulkDelete = useCallback((): void => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setDrawerNotice(null);
    setBulkDeleteConfirm(ids);
  }, [selectedIds]);

  const confirmBulkDelete = useCallback(async (): Promise<void> => {
    const ids = bulkDeleteConfirm;
    if (!ids || ids.length === 0) return;
    setBulkDeleteConfirm(null);
    optimisticDelete(ids);
    const deletedActive = activeId !== null && ids.includes(activeId);
    // Fire all deletions in parallel
    const results = await Promise.allSettled(
      ids.map((id) => deleteConversation(id)),
    );
    const failed = results.filter((r) => r.status === "rejected");
    const deletedCount = ids.length - failed.length;
    if (deletedCount > 0) captureAriTitleAction(surface, "deleted");
    qc.invalidateQueries({ queryKey: agentQueryKeys.conversationsRoot() });
    if (deletedActive) {
      qc.invalidateQueries({ queryKey: agentQueryKeys.messages(activeId) });
      onSelect(null);
    }
    setSelectMode(false);
    setSelectedIds(new Set());
    if (failed.length > 0) {
      setDrawerNotice(
        `Some deletions failed. ${failed.length} of ${ids.length} couldn’t be deleted. The list has been refreshed.`,
      );
    }
  }, [activeId, bulkDeleteConfirm, onSelect, optimisticDelete, qc, surface]);

  const handleRowPress = useCallback(
    (c: AgentConversation): void => {
      if (selectMode) {
        toggleSelect(c.id);
        return;
      }
      onSelect(c.id);
      if (!asPane) onClose();
    },
    [asPane, onClose, onSelect, selectMode, toggleSelect],
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
          style={styles.headerControl}
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
          style={styles.headerControl}
        >
          <Text style={styles.headerAction}>Select</Text>
        </Pressable>
      )
    : null;
  const scoped = hasSelectedBrand ? conversations.filter((conversation) => conversation.brand_id !== null) : conversations;
  const legacy = hasSelectedBrand ? conversations.filter((conversation) => conversation.brand_id === null) : [];

  const renderRow = (c: AgentConversation, readOnly: boolean): React.ReactNode => {
    const isActive = c.id === activeId;
    const isSelected = selectedIds.has(c.id);
    const date = friendlyDate(c.updated_at);
    const title = conversationDisplayTitle(c);
    return (
      <Pressable
        key={c.id}
        onPress={() => handleRowPress(c)}
        onLongPress={() => selectMode ? toggleSelect(c.id) : setMenuConversation(c)}
        delayLongPress={400}
        style={({ pressed }) => [styles.row, isActive && !selectMode && styles.rowActive, isSelected && styles.rowSelected, pressed && styles.btnPressed]}
        accessibilityRole="button"
        accessibilityLabel={readOnly ? `${title}, older read-only conversation, updated ${date}` : `${title}, updated ${date}`}
        accessibilityHint={selectMode ? "Tap to toggle selection" : "Tap to open; long-press for conversation actions"}
        accessibilityState={{ selected: selectMode ? isSelected : isActive }}
      >
        {selectMode ? (
          <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>{isSelected ? <Text style={styles.checkboxTick}>✓</Text> : null}</View>
        ) : readOnly ? <AlertTriangle size={16} color={color.text3} accessibilityElementsHidden /> : null}
        <View style={styles.rowCopy}>
          <View style={styles.titleWithStatus}>
            <Text style={styles.rowTitle} numberOfLines={3}>{title}</Text>
            {c.title_source === "provisional" ? (
              <AriOrb size="xs" thinking accessibilityLabel="Ari is naming this conversation" />
            ) : null}
          </View>
          <Text style={styles.rowDate}>{date}</Text>
        </View>
        {!selectMode ? (
          <Pressable
            style={styles.moreControl}
            accessibilityRole="button"
            accessibilityLabel={`More actions for ${title}`}
            disabled={regeneratingId === c.id}
            onPress={(event) => { event.stopPropagation(); setMenuConversation(c); }}
          >
            {regeneratingId === c.id
              ? <ActivityIndicator color={ariPalette.flame} />
              : typeof Ellipsis === "function"
                ? <Ellipsis size={20} color={color.text2} />
                : <Text style={styles.moreFallback}>...</Text>}
          </Pressable>
        ) : null}
      </Pressable>
    );
  };

  const body = (
      <View style={[styles.host, asPane ? styles.paneHost : null]}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Conversations</Text>
          {headerRight}
        </View>

        {!selectMode ? (
          <Pressable
            onPress={() => {
              onSelect(null);
              if (!asPane) onClose();
            }}
            style={({ pressed }) => [styles.newBtn, pressed && styles.btnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Start a new conversation"
          >
            <Text style={styles.newBtnText}>＋ New conversation</Text>
          </Pressable>
        ) : null}

        {drawerNotice ? (
          <Text style={styles.inlineNotice} accessibilityRole="alert">{drawerNotice}</Text>
        ) : null}

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
        >
          {isLoading ? [0, 1, 2].map((key) => <View key={key} style={styles.loadingRow} />) : null}
          {!isLoading && isError ? (
            <View accessibilityRole="alert" style={styles.errorState}>
              <Text style={styles.emptyHint}>Could not load conversations.</Text>
              <Pressable onPress={onRetry} style={styles.retryBtn} accessibilityRole="button"><Text style={styles.newBtnText}>Try again</Text></Pressable>
            </View>
          ) : null}
          {!isLoading && !isError ? (
            <>
              <Text style={styles.sectionCaption}>{selectedBrandName} chats</Text>
              {scoped.length ? scoped.map((c) => renderRow(c, false)) : <Text style={styles.emptyHint}>No chats for {selectedBrandName} yet.</Text>}
              {legacy.length ? <Text style={styles.sectionCaption}>Older chats · Read-only</Text> : null}
              {legacy.map((c) => renderRow(c, true))}
            </>
          ) : null}
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

        <Sheet visible={!!menuConversation} onClose={() => setMenuConversation(null)} snapPoint={310}>
          {menuConversation ? (
            <View style={styles.menuBody}>
              <Text style={styles.menuTitle} numberOfLines={2}>{conversationDisplayTitle(menuConversation)}</Text>
              <Pressable style={styles.menuAction} accessibilityRole="button" onPress={() => { setRenameDraft(conversationDisplayTitle(menuConversation)); setRenameConversation(menuConversation); setMenuConversation(null); }}><Text style={styles.menuActionText}>Rename conversation</Text></Pressable>
              <Pressable style={styles.menuAction} accessibilityRole="button" disabled={regeneratingId === menuConversation.id} onPress={() => handleRegenerate(menuConversation)}><Text style={styles.menuActionText}>Regenerate title</Text></Pressable>
              <Pressable style={styles.menuAction} accessibilityRole="button" onPress={() => handleDeleteSingle(menuConversation)}><Text style={styles.deleteActionText}>Delete</Text></Pressable>
              {menuNotice ? (
                <Text style={styles.inlineNotice} accessibilityRole="alert">{menuNotice}</Text>
              ) : null}
            </View>
          ) : null}
          {/* D-9: confirmations render INSIDE the sheet that opened them so iOS
              presents them from that sheet's own modal (#1369 pattern). */}
          {regenerateConfirm ? (
          <React.Suspense fallback={null}>
          <ConfirmDialog
            visible={!!regenerateConfirm}
            onClose={() => setRegenerateConfirm(null)}
            onConfirm={() => {
              const target = regenerateConfirm;
              setRegenerateConfirm(null);
              if (target) void regenerateTitle(target, true);
            }}
            title="Replace your name with a new Ari title?"
            description="Your current name will stay unless Ari creates a replacement."
            cancelLabel="Cancel"
            confirmLabel="Regenerate"
            initialFocus="cancel"
            testID="ari-regenerate-title-confirm"
          />
          </React.Suspense>
          ) : null}
          {deleteConfirm ? (
          <React.Suspense fallback={null}>
          <ConfirmDialog
            visible={!!deleteConfirm}
            onClose={() => setDeleteConfirm(null)}
            onConfirm={confirmDeleteSingle}
            title={deleteConfirm ? conversationDisplayTitle(deleteConfirm) : "Delete conversation"}
            description="Delete this conversation? This can't be undone."
            cancelLabel="Cancel"
            confirmLabel="Delete"
            destructive
            initialFocus="cancel"
            testID="ari-delete-conversation-confirm"
          />
          </React.Suspense>
          ) : null}
        </Sheet>

        <Sheet visible={!!renameConversation} onClose={() => setRenameConversation(null)} snapPoint={300}>
          <View style={styles.menuBody}>
            <Text style={styles.menuTitle}>Rename conversation</Text>
            {renameNotice ? (
              <Text style={styles.inlineNotice} accessibilityRole="alert">{renameNotice}</Text>
            ) : null}
            <TextInput
              value={renameDraft}
              onChangeText={setRenameDraft}
              maxLength={60}
              autoFocus
              placeholder="Conversation name"
              placeholderTextColor={color.text3}
              style={styles.renameInput}
              accessibilityLabel="Conversation name"
            />
            <View style={styles.renameActions}>
              <Pressable style={styles.menuAction} accessibilityRole="button" onPress={() => setRenameConversation(null)}><Text style={styles.menuActionText}>Cancel</Text></Pressable>
              <Pressable
                style={[styles.saveAction, !renameDraft.trim() && styles.btnDisabled]}
                accessibilityRole="button"
                accessibilityLabel="Save conversation name"
                disabled={!renameDraft.trim()}
                onPress={async () => {
                  if (!renameConversation || !renameDraft.trim()) return;
                  setRenameNotice(null);
                  try {
                    await renameAgentConversation(renameConversation.id, renameDraft.trim());
                    captureAriTitleAction(surface, "renamed");
                    await qc.invalidateQueries({ queryKey: agentQueryKeys.conversationsRoot() });
                    setRenameConversation(null);
                  } catch {
                    setRenameNotice("Couldn’t rename. Your previous title is unchanged.");
                  }
                }}
              ><Text style={styles.saveActionText}>Save</Text></Pressable>
            </View>
          </View>
        </Sheet>

        {bulkDeleteConfirm ? (
        <React.Suspense fallback={null}>
        <ConfirmDialog
          visible={!!bulkDeleteConfirm}
          onClose={() => setBulkDeleteConfirm(null)}
          onConfirm={confirmBulkDelete}
          title={`Delete ${bulkDeleteConfirm?.length ?? 0} ${(bulkDeleteConfirm?.length ?? 0) === 1 ? "conversation" : "conversations"}?`}
          description="This can't be undone."
          cancelLabel="Cancel"
          confirmLabel="Delete"
          destructive
          initialFocus="cancel"
          testID="ari-bulk-delete-confirm"
        />
        </React.Suspense>
        ) : null}
      </View>
  );

  if (asPane) {
    return (
      <View
        style={styles.pane}
        accessibilityLabel="Conversations"
        testID="ari-conversation-pane"
      >
        {body}
      </View>
    );
  }
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={0.82} style={Platform.OS === "web" ? styles.webSheet : undefined}>
      {body}
    </Sheet>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    paddingHorizontal: space[6],
    paddingTop: space[4],
    paddingBottom: space[4],
    gap: space[2],
  },
  webSheet: { width: 440, maxHeight: "80%" },
  // #4420 — wide-desktop side pane (mockup: 320 wide, its own card).
  pane: {
    width: ariConversationPaneWidth,
    alignSelf: "stretch",
    borderRadius: radius.xl,
    backgroundColor: color.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    overflow: "hidden",
  },
  paneHost: {
    paddingHorizontal: space[4],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space[2],
    minHeight: 32,
  },
  title: {
    fontSize: 20,
    lineHeight: 32,
    fontWeight: "600",
    color: color.text1,
    letterSpacing: -0.2,
  },
  headerAction: {
    fontSize: 14,
    fontWeight: "600",
    color: ariPalette.flame,
    letterSpacing: -0.1,
  },
  headerControl: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  newBtn: {
    paddingVertical: 10,
    paddingHorizontal: space[4],
    backgroundColor: color.fill.tile,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    minHeight: 52,
    justifyContent: "center",
    marginBottom: space[1],
  },
  newBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: color.text1,
    letterSpacing: -0.1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    gap: 4,
    paddingBottom: space[4],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    minHeight: 64,
    gap: space[2],
  },
  rowActive: {
    backgroundColor: Platform.OS === "android" ? color.card : color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
  },
  rowSelected: {
    backgroundColor: color.fill.tabOn, // ariPalette.flame at 10%
    borderWidth: 1,
    borderColor: ariPalette.proposalBorder,
  },
  rowTitle: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: color.text1,
    letterSpacing: -0.1,
  },
  rowDate: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    color: color.text3,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: color.text3,
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
    color: color.textStrong,
    lineHeight: 14,
  },
  emptyHint: {
    fontSize: 13,
    color: color.text3,
    paddingVertical: space[4],
    textAlign: "center",
  },
  sectionCaption: { fontSize: 12, color: color.text2, paddingHorizontal: space[2], paddingTop: space[2] },
  rowCopy: { flex: 1, minWidth: 0, gap: space[1] },
  titleWithStatus: { flexDirection: "row", alignItems: "center", gap: space[1] },
  moreControl: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  moreFallback: { color: color.text2, fontSize: 16 },
  loadingRow: { minHeight: 64, borderRadius: 12, backgroundColor: Platform.OS === "android" ? color.card : color.fill.inset, marginBottom: 4, overflow: "hidden" },
  errorState: { alignItems: "center", gap: space[2] },
  retryBtn: { minHeight: 44, minWidth: 120, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: color.line },
  bulkBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: space[2],
    paddingHorizontal: space[2],
    borderTopWidth: 1,
    borderTopColor: color.line,
    gap: space[4],
  },
  bulkCount: {
    fontSize: 13,
    color: color.text2,
    letterSpacing: -0.1,
  },
  bulkDeleteBtn: {
    paddingHorizontal: space[4],
    paddingVertical: 9,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: color.errorTint,
    borderWidth: 1,
    borderColor: color.errorLine,
    minHeight: 44,
    justifyContent: "center",
  },
  bulkDeleteText: {
    fontSize: 13,
    fontWeight: "600",
    color: color.danger,
    letterSpacing: -0.1,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  menuBody: { paddingHorizontal: space[6], paddingBottom: space[6], gap: space[2] },
  inlineNotice: { color: color.errorText, fontSize: 14, lineHeight: 20 },
  menuTitle: { color: color.text1, fontSize: 20, lineHeight: 32, fontWeight: "600" },
  menuAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: space[4], borderRadius: radius.md },
  menuActionText: { color: color.text1, fontSize: 15, lineHeight: 20, fontWeight: "600" },
  deleteActionText: { color: color.danger, fontSize: 15, lineHeight: 20, fontWeight: "600" },
  renameInput: { minHeight: 52, color: color.text1, fontSize: 16, lineHeight: 24, borderWidth: 1, borderColor: color.line, borderRadius: radius.md, backgroundColor: Platform.OS === "android" ? color.card : color.fill.inset, paddingHorizontal: space[4] },
  renameActions: { flexDirection: "row", justifyContent: "flex-end", gap: space[2] },
  saveAction: { minHeight: 44, minWidth: 88, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: ariPalette.userBubble },
  saveActionText: { color: color.ink, fontSize: 14, fontWeight: "700" },
});

export default ConversationDrawer;
