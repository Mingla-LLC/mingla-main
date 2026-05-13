/**
 * ORCH-0821 — AriChatScreen
 * Main composition of the Ari chat surface.
 *
 * Composition order:
 *   - AiDisclosureModal (if user hasn't acknowledged yet)
 *   - Header (drawer button + title + settings link)
 *   - ConversationDrawer (overlay)
 *   - MessageList (with optional pending ToolProposalCard)
 *   - StreamingText (thinking indicator)
 *   - InputBar at bottom (keyboard-aware via KeyboardAvoidingView)
 *   - Toast (canonical app-wide toast — supports tap, close button, swipe-up to dismiss)
 */

import React, { useEffect, useState } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { KeyboardEvent } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canvas,
  glass,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { AriOrb } from "../../components/ari/AriOrb";
import { AiDisclosureModal } from "../../components/ari/AiDisclosureModal";
import { ConversationDrawer } from "../../components/ari/ConversationDrawer";
import { EmptyState } from "../../components/ari/EmptyState";
import { InputBar } from "../../components/ari/InputBar";
import { MessageList } from "../../components/ari/MessageList";
import { QuickReplyChips } from "../../components/ari/QuickReplyChips";
import { StreamingText } from "../../components/ari/StreamingText";
import { Toast } from "../../components/ui/Toast";

import { useAgentChat } from "../../hooks/useAgentChat";
import { useAriPreferences } from "../../hooks/useAriPreferences";
import { useConfirmPendingAction } from "../../hooks/useConfirmPendingAction";
import { useConversationList } from "../../hooks/useConversationList";

// Height the floating BottomNav capsule occupies above the safe-area bottom.
// Matches NAV_HEIGHT (64) + paddingTop (8) + paddingBottom (≥8) in
// (tabs)/_layout.tsx — leave 80pt clearance when the keyboard is closed
// so the input bar doesn't tuck behind the nav.
const BOTTOM_NAV_CLEARANCE_PX = 80;

export const AriChatScreen: React.FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  // Cycle 3 wizard pattern — manual keyboard listeners so we can tighten
  // the bottom padding when the keyboard is up. KeyboardAvoidingView's
  // padding behaviour stacks ON TOP of our BottomNav clearance, leaving
  // an awkward gap above the keyboard. Listening directly lets us swap
  // in keyboardHeight when up and BOTTOM_NAV_CLEARANCE_PX when down.
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (e: KeyboardEvent) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });
    return (): void => {
      show.remove();
      hide.remove();
    };
  }, []);

  const prefs = useAriPreferences();
  const conversations = useConversationList();

  const chat = useAgentChat(null, null);
  const confirm = useConfirmPendingAction(chat.conversationId);

  const disclosureNeeded =
    !prefs.isLoading && prefs.profile?.ai_disclosure_acknowledged_at == null;

  const handleSend = async (text: string): Promise<void> => {
    setLocalError(null);
    const result = await chat.sendMessage(text);
    if (result.kind === "error") {
      setLocalError(result.message);
    }
  };

  const handleConfirm = async (
    editedArgs?: Record<string, unknown>,
  ): Promise<void> => {
    if (!chat.pendingAction) return;
    setLocalError(null);
    const result = await confirm.confirm(chat.pendingAction.pending_action_id, editedArgs);
    if (result.kind === "error") {
      setLocalError(result.message);
    } else {
      chat.clearPendingAction();
    }
  };

  const handleCancelProposal = async (): Promise<void> => {
    if (!chat.pendingAction) return;
    setLocalError(null);
    await confirm.cancel(chat.pendingAction.pending_action_id);
    chat.clearPendingAction();
  };

  const handleSelectConversation = (id: string | null): void => {
    chat.setConversationId(id);
    chat.clearPendingAction();
  };

  const displayError = localError ?? chat.errorMessage;
  const noMessages = chat.messages.length === 0 && chat.conversationId == null;

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => setDrawerOpen(true)}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Show conversations"
        >
          <Text style={styles.iconText}>≡</Text>
        </Pressable>
        <View style={styles.headerTitle}>
          <AriOrb size="sm" decorative />
          <Text style={styles.title}>Ari</Text>
        </View>
        <Pressable
          onPress={() => router.push("/ari/settings" as never)}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Open Ari settings"
        >
          <Text style={styles.iconText}>⚙</Text>
        </Pressable>
      </View>

      <Toast
        visible={!!displayError}
        kind="error"
        message={displayError ?? ""}
        onDismiss={() => {
          // Both state sources MUST clear or the toast re-mounts on the
          // next render frame (since displayError = localError ?? chat.errorMessage).
          setLocalError(null);
          chat.clearErrorMessage();
        }}
      />

      <View style={styles.kav}>
        {noMessages ? (
          <EmptyState onChipSelect={handleSend} />
        ) : (
          <MessageList
            messages={chat.messages}
            pendingAction={chat.pendingAction}
            isExecuting={confirm.isExecuting}
            onConfirm={handleConfirm}
            onCancel={handleCancelProposal}
            isThinking={chat.isSending && !chat.pendingAction}
            renderThinking={() => <StreamingText visible />}
          />
        )}

        <View
          style={[
            styles.inputWrap,
            {
              // When keyboard is up, sit JUST above the keyboard with a
              // small breath (spacing.sm). When closed, clear the floating
              // BottomNav capsule + safe-area inset.
              paddingBottom:
                keyboardHeight > 0
                  ? keyboardHeight + spacing.sm
                  : Math.max(insets.bottom, spacing.md) + BOTTOM_NAV_CLEARANCE_PX,
            },
          ]}
        >
          {suggestionsOpen ? (
            <View style={styles.suggestionsPanel}>
              <QuickReplyChips
                chips={[
                  "Create a brand called Sample Events",
                  "What events do I have this week?",
                  "Help me schedule a Friday event",
                ]}
                onSelect={(chip) => {
                  setSuggestionsOpen(false);
                  void handleSend(chip);
                }}
                layout="stack"
              />
            </View>
          ) : null}
          <InputBar
            onSend={handleSend}
            disabled={chat.isSending}
            onShowSuggestions={() => setSuggestionsOpen((v) => !v)}
          />
        </View>
      </View>

      <ConversationDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        conversations={conversations.conversations}
        activeId={chat.conversationId}
        onSelect={handleSelectConversation}
      />

      <AiDisclosureModal
        visible={disclosureNeeded}
        onAccept={() => {
          prefs.acknowledge().catch(() => undefined);
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: glass.border.profileBase,
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    fontSize: 22,
    color: textTokens.primary,
  },
  headerTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  pressed: {
    opacity: 0.7,
  },
  kav: {
    flex: 1,
  },
  inputWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  suggestionsPanel: {
    marginBottom: spacing.sm,
  },
});

export default AriChatScreen;
