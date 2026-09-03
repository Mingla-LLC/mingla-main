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

import React, { useState } from "react";
import {
  AccessibilityInfo,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Menu, Settings } from "lucide-react-native";

import {
  accent,
  canvas,
  ariPalette,
  ariThread,
  glass,
  radius,
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
import type { ConfirmOutcome } from "../../components/ari/toolProposalTypes";
import { QuickReplyChips } from "../../components/ari/QuickReplyChips";
import { StreamingText } from "../../components/ari/StreamingText";
import { Toast } from "../../components/ui/Toast";
import { useShareNetworkState } from "../../components/ui/useShareNetworkState";
import type { AgentChoiceSubmissionV2 } from "../../services/agentChatService";
import { BrandSwitcherSheet } from "../../components/brand/BrandSwitcherSheet";

import { useAgentChat } from "../../hooks/useAgentChat";
import { useAriPreferences } from "../../hooks/useAriPreferences";
import { useConfirmPendingAction } from "../../hooks/useConfirmPendingAction";
import { useConversationList } from "../../hooks/useConversationList";
import { useBrands } from "../../hooks/useBrands";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useAuth } from "../../context/AuthContext";
import {
  ariConversationScopeKey,
  hasStoredAriConversationSelection,
  resolveRestoredAriConversation,
  useAriConversationSelectionStore,
} from "../../store/ariConversationSelectionStore";
// #1841 [keyboard-guard-blind-spots] — the composer's keyboard height now comes
// from a react-native-keyboard-controller-backed wrapper instead of a bespoke
// Keyboard.addListener pair. See src/wrappers/useKeyboardHeight.native.ts for
// why `useGenericKeyboardHandler` + `onStart` is the frame-timing equivalent of
// the iOS `keyboardWillShow` listener it replaces. `Keyboard` stays imported for
// `Keyboard.dismiss()`, which is not a listener and is not in scope for
// orch-0892.
import { useKeyboardHeight } from "../../wrappers/useKeyboardHeight";
// #1850 [quarantined-checkout-pins] — the Done-bar term in the composer lift is
// the DERIVED cost of the bar, not the hand-typed 42 that used to sit here. Metro
// picks the .native variant (53 on iOS 26+, 42 elsewhere); the web variant exports
// 0, which the web branch below never reads anyway.
import { DONE_BAR_OCCUPIED } from "../../wrappers/SmartScrollView";
// #1890 [keyboard-clearance-overshoot] — the visible gap promised above the
// bar, from the shared occluder budget. Both platform variants export it, so
// the web branch below can never read `undefined` and budget NaN.
import { MIN_VISIBLE_CLEARANCE } from "../../wrappers/keyboardClearance";

// Height the floating BottomNav capsule occupies above the safe-area bottom.
// Matches NAV_HEIGHT (64) + paddingTop (8) + paddingBottom (≥8) in
// (tabs)/_layout.tsx — leave 80pt clearance when the keyboard is closed
// so the input bar doesn't tuck behind the nav.
const BOTTOM_NAV_CLEARANCE_PX = 80;

/**
 * ORCH-1103 REWORK 3 — true when a confirm error means the pending action was
 * simply no longer "pending" (executed / cancelled / expired / raced), as
 * opposed to a real failure. The edge fn's confirmAgentAction collapses the
 * server `code` to "EDGE_ERROR" but preserves the human message verbatim, so we
 * match the WRONG_STATE / race phrasings. Such taps are a no-op (clear the stale
 * card silently), never the alarming red error toast.
 */
function isAlreadyResolvedError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("current status:") || // "Cannot confirm — current status: executed|cancelled|expired"
    m.includes("already handled") // "Race detected — this action was already handled"
  );
}

function isExpiredActionError(code: string, message: string): boolean {
  return code === "EXPIRED" || message.toLowerCase().includes("status: expired") ||
    message.toLowerCase().includes("proposal expired");
}

type Recovery = { code: string; title: string; body: string; action?: string };

const RecoveryPanel: React.FC<{ recovery: Recovery; onAction: () => void }> = ({ recovery, onAction }) => {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.recoveryPanel} accessibilityRole="alert">
      <Text style={styles.recoveryTitle}>{recovery.title}</Text>
      <Text style={styles.recoveryBody}>{recovery.body}</Text>
    {recovery.action ? (
      <Pressable
        onPress={onAction}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed }) => [styles.recoveryAction, pressed && styles.pressed, focused && styles.recoveryActionFocused]}
        accessibilityRole="button"
        accessibilityLabel={recovery.action}
      >
        <Text style={styles.recoveryActionText}>{recovery.action}</Text>
      </Pressable>
    ) : null}
    </View>
  );
};

export interface AriChatScreenProps {
  /**
   * #2830 — render inside a host that already owns the page chrome.
   *
   * The Website workspace puts Ari in the right-hand column of a split view
   * beside a live draft preview. In that position the screen must NOT pad for
   * the device notch (its container already did) and must NOT draw its own
   * "Ari" title bar (the workspace names the page). Everything else — the
   * conversation, the composer, tool proposals, the drawer — is identical, so
   * the split view and the tab cannot drift into two different Aris.
   */
  embedded?: boolean;
}

export const AriChatScreen: React.FC<AriChatScreenProps> = ({
  embedded = false,
}) => {
  const router = useRouter();
  /*
   * #2830 — the Website split view is a MODE of this screen, not a second
   * screen. A separate route importing this module gave it a second consumer,
   * and Metro hoists anything shared between two chunks into the boot payload
   * every Business user downloads: a measured 133KB for people who may never
   * open Ari. Rendering the draft beside the conversation here keeps one
   * consumer and the same two-column layout.
   */
  const { isWideDesktop } = useResponsiveLayout();
  const sitesParams = useLocalSearchParams<{
    sitesIntent?: string | string[];
    brandId?: string | string[];
  }>();
  const sitesIntent = Array.isArray(sitesParams.sitesIntent)
    ? sitesParams.sitesIntent[0]
    : sitesParams.sitesIntent;
  const sitesBrandId = Array.isArray(sitesParams.brandId)
    ? sitesParams.brandId[0]
    : sitesParams.brandId;
  const websiteSplit = sitesIntent === "edit" &&
    typeof sitesBrandId === "string" && sitesBrandId.length > 0;
  const insets = useSafeAreaInsets();
  const online = useShareNetworkState();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  // #1841 — library-backed; 0 on web and while the keyboard is closed. Same
  // value, same timing as the deleted listener pair; no bespoke plumbing.
  const keyboardHeight = useKeyboardHeight();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [brandSwitcherOpen, setBrandSwitcherOpen] = useState(false);
  const [retryText, setRetryText] = useState<string | null>(null);
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
  const [cooldownNow, setCooldownNow] = useState(() => Date.now());
  // ORCH-1101 REWORK Bug #6 — dismiss the AI-disclosure sheet the instant the
  // CTA is tapped, decoupled from the acknowledge mutation's network round-trip
  // + profile-query refetch. Previously the sheet only closed when the refetched
  // profile reported a non-null ai_disclosure_acknowledged_at — so on a slow (or
  // failed) refetch the button "did nothing". This local flag is the source of
  // truth for dismissal; the mutation still persists in the background.
  const [disclosureDismissed, setDisclosureDismissed] = useState(false);
  // ORCH-1103 REWORK 3 — cover attached AFTER a create-and-attach commit, keyed
  // by the (now-executed) pending_action_id. The executed tool_result row was
  // written before the cover landed, so its cover is null; this override lets
  // the receipt render the cover the user actually attached. Keyed (not a single
  // slot) so a stale override can never bleed onto a different brand's receipt.
  const [attachedCovers, setAttachedCovers] = useState<
    Record<string, { url: string | null; type: string | null }>
  >({});

  // The composer swaps in `keyboardHeight` when the keyboard is up and
  // BOTTOM_NAV_CLEARANCE_PX when it is down; a plain KeyboardAvoidingView
  // cannot express that because its padding stacks ON TOP of the BottomNav
  // clearance, leaving an awkward gap above the keyboard. The height itself now
  // comes from `useKeyboardHeight` (library-backed) — see the import comment.
  // The bespoke Keyboard.addListener pair that used to live here was deleted
  // by #1841; do not reinstate it.

  const prefs = useAriPreferences();
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const currentBrand = useCurrentBrand();
  const selectedBrandId = currentBrand?.id ?? null;
  const conversations = useConversationList(selectedBrandId);
  const conversationScopeKey = ariConversationScopeKey(accountId, selectedBrandId);
  const storedConversationSelections = useAriConversationSelectionStore((state) => state.selections);
  const conversationSelectionHydrated = useAriConversationSelectionStore((state) => state.hasHydrated);
  const setStoredConversationSelection = useAriConversationSelectionStore((state) => state.setSelection);
  // ORCH-1103 — brand name lookup for delete/update target display +
  // type-to-confirm matching. Mirrors the prompt-known brand list.
  const brands = useBrands(accountId);
  const brandNamesById = React.useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const b of brands.data ?? []) out[b.id] = b.displayName;
    return out;
  }, [brands.data]);

  const persistConversationSelection = React.useCallback((conversationId: string | null): void => {
    if (conversationScopeKey) {
      setStoredConversationSelection(conversationScopeKey, conversationId);
    }
  }, [conversationScopeKey, setStoredConversationSelection]);
  const chat = useAgentChat(null, selectedBrandId, persistConversationSelection);
  const [restoredConversationScope, setRestoredConversationScope] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!conversationScopeKey || !selectedBrandId) {
      setRestoredConversationScope(null);
      return;
    }
    if (
      !conversationSelectionHydrated ||
      conversations.isLoading ||
      conversations.isError ||
      restoredConversationScope === conversationScopeKey
    ) return;

    const hasStoredSelection = hasStoredAriConversationSelection(
      storedConversationSelections,
      conversationScopeKey,
    );
    const storedSelection = hasStoredSelection
      ? storedConversationSelections[conversationScopeKey]
      : undefined;
    const restoredConversationId = resolveRestoredAriConversation(
      storedSelection,
      conversations.conversations,
      selectedBrandId,
    );
    chat.setConversationId(restoredConversationId);
    setRestoredConversationScope(conversationScopeKey);
  }, [
    chat.setConversationId,
    conversationScopeKey,
    conversationSelectionHydrated,
    conversations.conversations,
    conversations.isError,
    conversations.isLoading,
    restoredConversationScope,
    selectedBrandId,
    storedConversationSelections,
  ]);
  const previousBrandId = React.useRef(selectedBrandId);
  const brandScopeStable = previousBrandId.current === selectedBrandId;

  React.useEffect(() => {
    if (previousBrandId.current === selectedBrandId) return;
    previousBrandId.current = selectedBrandId;
    setDrawerOpen(false);
    setSuggestionsOpen(false);
    setLocalError(null);
    setRetryText(null);
    setRateLimitUntil(null);
    Keyboard.dismiss();
  }, [currentBrand?.displayName, selectedBrandId]);
  const confirm = useConfirmPendingAction(chat.conversationId);

  const disclosureNeeded =
    !disclosureDismissed &&
    !prefs.isLoading &&
    prefs.profile?.ai_disclosure_acknowledged_at == null;

  const handleAcceptDisclosure = (): void => {
    // Dismiss immediately (Bug #6) — the sheet must close on tap regardless of
    // network latency. Persist in the background; if it fails, surface the error
    // via the existing toast so the consent silently-lost case is visible rather
    // than swallowed (the old `.catch(() => undefined)` hid every failure).
    setDisclosureDismissed(true);
    prefs.acknowledge().catch((err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Couldn't save your preference — it'll ask again next time.";
      setLocalError(message);
    });
  };

  const handleSend = async (text: string): Promise<boolean> => {
    if (!online) {
      setLocalError("You're offline. Reconnect to continue this plan.");
      return false;
    }
    if (rateLimitUntil !== null && rateLimitUntil > Date.now()) return false;
    setLocalError(null);
    const result = await chat.sendMessage(text);
    if (result.kind === "error") {
      if (["BRAND_CONTEXT_REQUIRED", "BRAND_ACCESS_DENIED", "CONVERSATION_BRAND_MISMATCH", "LEGACY_CONVERSATION_UNSCOPED", "TENANT_SCOPE_UNAVAILABLE", "UNAUTHORIZED"].includes(result.code)) {
        setRetryText(text);
      } else if (result.code === "RATE_LIMITED") {
        const parsedUntil = result.cooldown_until ? Date.parse(result.cooldown_until) : Number.NaN;
        const fallbackMs = Math.max(1, result.retry_after_seconds ?? 5) * 1000;
        setRateLimitUntil(Number.isFinite(parsedUntil) && parsedUntil > Date.now() ? parsedUntil : Date.now() + fallbackMs);
        setCooldownNow(Date.now());
      } else {
        const copy: Record<string, string> = {
          TASK_STATE_CONFLICT: "This plan changed on another device. Ari refreshed it; choose again.",
          CHOICE_STALE: "That choice is no longer active. Ari refreshed the current step.",
          TIMEZONE_REQUIRED: "Ari needs your timezone before choosing an exact date and time.",
          PLANNER_UNAVAILABLE: "Ari couldn't safely plan that step. Your progress is saved; try again.",
          TASK_STATE_INVALID: "Ari couldn't safely read this plan. Nothing was changed.",
          TASK_STATE_OVERSIZED: "This plan is too large to continue safely. Start a new Ari chat.",
          TASK_RECOVERY_REQUIRED: "The action finished, but Ari needs to reconcile the plan before continuing.",
        };
        setLocalError(copy[result.code] ?? "Ari could not connect — check your connection and try again.");
      }
      return false;
    }
    if (result.kind === "text" && result.handoff_route) router.push(result.handoff_route as never);
    setRetryText(null);
    return true;
  };

  const handleChoice = async (submission: AgentChoiceSubmissionV2, label: string): Promise<void> => {
    if (!online) {
      setLocalError("You're offline. Reconnect to continue this plan.");
      return;
    }
    const result = await chat.sendChoice(submission, label);
    if (result.kind === "error") {
      setLocalError(result.code === "CHOICE_STALE"
        ? "That choice is no longer active. Ari refreshed the current step."
        : result.message);
    } else if (result.kind === "text" && result.handoff_route) {
      router.push(result.handoff_route as never);
    }
  };

  const handleConfirm = async (
    editedArgs?: Record<string, unknown>,
    // ORCH-1103 Q7 — when the create commit is fired ONLY to obtain a brandId
    // for the cover picker (create-row-first / attach-second), the proposal card
    // must stay mounted so it can host the picker and transition to the receipt
    // itself. In that case we DON'T clear the pending action here; the card
    // clears it via onAttachDone once the cover attach finishes.
    keepPending?: boolean,
  ): Promise<ConfirmOutcome> => {
    if (!chat.pendingAction) return { ok: false };
    setLocalError(null);
    let result: Awaited<ReturnType<typeof confirm.confirm>>;
    try {
      result = await confirm.confirm(chat.pendingAction.pending_action_id, editedArgs);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Couldn't complete that action — try again.";
      setLocalError(message);
      return { ok: false, error: message };
    }
    if (result.kind === "error") {
      if (isExpiredActionError(result.code, result.message)) {
        const message = "This proposal expired. Ask Ari to propose it again.";
        setLocalError(message);
        chat.clearPendingAction();
        return { ok: false, error: message, terminal: "expired" };
      }
      // ORCH-1103 REWORK 3 — guard the already-executed / expired / raced case.
      // If the pending action is no longer "pending" the edge fn returns
      // WRONG_STATE ("Cannot confirm — current status: executed" / "…cancelled"
      // / "…expired") or a race ("already handled"). A normal tap must NOT raise
      // the alarming red error toast for an action that was simply already
      // resolved — it's a no-op: silently clear the now-stale card. (The primary
      // fix removes the re-confirm affordance entirely; this is the belt for any
      // other path that lands on a non-pending action.)
      if (isAlreadyResolvedError(result.message)) {
        chat.clearPendingAction();
        return { ok: false, terminal: "resolved" };
      }
      setLocalError(result.message);
      return { ok: false, error: result.message };
    }
    if (result.kind === "proposal_replaced") {
      chat.clearPendingAction();
      return { ok: false };
    }
    // ORCH-1103 — surface the freshly-created/updated brand id to the proposal
    // card so the Q7 create-row-first / attach-second cover flow can re-target
    // the picker to a real brandId. The executed result shape is
    // { brand: { id, ... } } for create_brand / update_brand.
    let brandId: string | undefined;
    if (result.kind === "executed") {
      const r = result.result as { brand?: { id?: string } } | null | undefined;
      if (typeof r?.brand?.id === "string") brandId = r.brand.id;
    }
    if (!keepPending) chat.clearPendingAction();
    return { ok: true, brandId };
  };

  const handleCancelProposal = async (): Promise<void> => {
    if (!chat.pendingAction) return;
    setLocalError(null);
    try {
      const result = await confirm.cancel(chat.pendingAction.pending_action_id);
      if (result.kind === "error") {
        setLocalError(result.message);
        return;
      }
      chat.clearPendingAction();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Couldn't cancel — try again.");
    }
  };

  const handleSelectConversation = (id: string | null): void => {
    chat.setConversationId(id);
    chat.clearPendingAction();
  };

  const displayError = localError ?? chat.errorMessage;
  const conversationSelectionReady =
    conversationScopeKey === null || restoredConversationScope === conversationScopeKey;
  const noMessages = conversationSelectionReady && chat.messages.length === 0 && chat.conversationId == null;
  const activeConversation = conversations.conversations.find((item) => item.id === chat.conversationId);
  const legacyReadOnly = !!selectedBrandId && activeConversation?.brand_id === null;
  const brandSelectionRequired = !selectedBrandId && (brands.data?.length ?? 0) > 0;
  const brandName = currentBrand?.displayName ?? "selected brand";
  const rateLimited = rateLimitUntil !== null && rateLimitUntil > cooldownNow;
  const cooldownSeconds = rateLimited ? Math.max(1, Math.ceil((rateLimitUntil - cooldownNow) / 1000)) : 0;

  React.useEffect(() => {
    if (!rateLimited) {
      if (rateLimitUntil !== null) setRateLimitUntil(null);
      return;
    }
    const timer = setInterval(() => setCooldownNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [rateLimitUntil, rateLimited]);
  const recovery: Recovery | null = legacyReadOnly || chat.errorCode === "LEGACY_CONVERSATION_UNSCOPED"
    ? { code: "LEGACY_CONVERSATION_UNSCOPED", title: "This older chat is read-only", body: "It was not saved to a brand, so Ari cannot safely continue it.", action: `Start a new chat for ${brandName}` }
    : chat.errorCode === "BRAND_ACCESS_DENIED"
      ? { code: chat.errorCode, title: "You no longer have access to this brand", body: "Choose a brand you can access to start a new chat.", action: "Choose a brand" }
      : chat.errorCode === "CONVERSATION_BRAND_MISMATCH"
        ? { code: chat.errorCode, title: "This chat belongs to another brand", body: "Ari will not move a conversation between brands.", action: `Start a new chat for ${brandName}` }
        : chat.errorCode === "TENANT_SCOPE_UNAVAILABLE"
          ? { code: chat.errorCode, title: "Ari cannot verify your brand right now", body: "Nothing was sent. Try again in a moment.", action: "Try again" }
          : chat.errorCode === "UNAUTHORIZED"
            ? { code: chat.errorCode, title: "Your session expired", body: "Sign in again to keep chatting with Ari.", action: "Sign in" }
            : brandSelectionRequired || chat.errorCode === "BRAND_CONTEXT_REQUIRED"
              ? { code: "BRAND_CONTEXT_REQUIRED", title: "Choose a brand to chat with Ari", body: "Ari keeps each conversation tied to one brand.", action: "Choose a brand" }
              : null;

  React.useEffect(() => {
    if (recovery) AccessibilityInfo.announceForAccessibility(`${recovery.title}. ${recovery.body}`);
  }, [recovery?.code]);

  const handleRecovery = (): void => {
    if (recovery?.code === "TENANT_SCOPE_UNAVAILABLE" && retryText) {
      void handleSend(retryText);
    } else if (recovery?.code === "UNAUTHORIZED") {
      router.replace("/" as never);
    } else if (recovery?.code === "BRAND_CONTEXT_REQUIRED" || recovery?.code === "BRAND_ACCESS_DENIED") {
      setBrandSwitcherOpen(true);
    } else {
      chat.setConversationId(null);
      chat.clearErrorMessage();
    }
  };

  return (
    <View
      style={[
        styles.host,
        { paddingTop: embedded ? 0 : insets.top },
        // #2830 — draft LEFT, conversation RIGHT, on wide desktop only. At
        // 390pt a split column gives neither half enough room, so the phone
        // keeps the full-width conversation it already had.
        websiteSplit && isWideDesktop ? styles.websiteSplitHost : null,
      ]}
    >
      {websiteSplit && isWideDesktop ? (
        <View style={styles.websiteDraftPane} testID="ari-website-draft">
          <Text style={styles.websiteDraftLabel}>Draft</Text>
          <Text style={styles.websiteDraftBody}>
            Ari edits this website. Open a private preview from the Website
            workspace to see the exact draft, then publish there — publishing
            stays a separate, deliberate step.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push(`/brand/${sitesBrandId}/website` as never)}
            style={styles.websiteDraftAction}
          >
            <Text style={styles.websiteDraftActionLabel}>
              Back to the Website workspace
            </Text>
          </Pressable>
        </View>
      ) : null}
      {/* Header — the embedding host owns the page title, so it is dropped
          there rather than stacking two headers in one column. */}
      <View style={[styles.header, embedded ? styles.headerEmbedded : null]}>
        <Pressable
          onPress={() => setDrawerOpen(true)}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Show conversations"
        >
          <Menu size={24} color={textTokens.primary} strokeWidth={2} />
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
          <Settings size={22} color={textTokens.primary} strokeWidth={2} />
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
        {!conversationSelectionReady ? (
          <View style={styles.flexSpacer} accessibilityLabel="Restoring Ari conversation">
            <StreamingText visible />
          </View>
        ) : noMessages ? (
          <>
            {/* Hero lives in an absolute overlay so the composer rising with the
                keyboard can NOT squeeze the flex column and re-center (jump) the
                orb. Its paddingBottom keeps the hero above the resting composer
                and is keyboard-independent, so it stays put when the keyboard
                opens. Tapping anywhere dismisses the keyboard — the only escape
                on a multiline composer where Return inserts a newline. */}
            <Pressable
              style={[
                styles.emptyOverlay,
                {
                  paddingBottom:
                    Math.max(insets.bottom, spacing.md) +
                    BOTTOM_NAV_CLEARANCE_PX +
                    60,
                },
              ]}
              onPress={() => Keyboard.dismiss()}
              accessibilityRole="button"
              accessibilityLabel="Dismiss keyboard"
            >
              <EmptyState />
            </Pressable>
            <View style={styles.flexSpacer} pointerEvents="none" />
          </>
        ) : (
          <MessageList
            messages={chat.messages}
            pendingAction={chat.pendingAction}
            isExecuting={confirm.isExecuting}
            onConfirm={handleConfirm}
            onCancel={handleCancelProposal}
            isThinking={chat.isSending && !chat.pendingAction}
            renderThinking={() => <StreamingText visible />}
            brandNamesById={brandNamesById}
            accountId={accountId}
            onSeedMessage={(text) => void handleSend(text)}
            // ORCH-1103 REWORK 2 — a disambiguation / no-brand-handoff chip tap
            // sends the chip label as a normal user turn (Q2 conversational
            // feedback; Gemini re-proposes with the resolved target).
            onSendChoice={(submission, label) => void handleChoice(submission, label)}
            onRetryTurn={(clientTurnId) => {
              if (!online) {
                setLocalError("You're offline. Reconnect to continue this plan.");
                return;
              }
              void chat.retryTurn(clientTurnId).then((result) => {
                if (result?.kind === "error") setLocalError(result.message);
              }).catch((error: unknown) => {
                setLocalError(error instanceof Error
                  ? error.message
                  : "Ari could not retry that message. Try again.");
              });
            }}
            choicesDisabled={chat.isSending || !online}
            attachedCovers={attachedCovers}
            onAttachDone={(cover) => {
              // ORCH-1103 REWORK 3 — stash the attached cover against the
              // resolving pending action so the receipt renders it, THEN clear
              // the pending action (which mounts the receipt exactly once).
              const pid = chat.pendingAction?.pending_action_id;
              if (pid && cover && cover.url) {
                setAttachedCovers((prev) => ({ ...prev, [pid]: cover }));
              }
              chat.clearPendingAction();
            }}
          />
        )}

        <View
          style={[
            styles.inputWrap,
            {
              // ORCH-1101 Bug A (screen side): on desktop web there is no soft
              // keyboard (keyboardHeight stays 0) and no floating BottomNav
              // capsule (the business web nav is a side rail), so the old
              // `insets.bottom + BOTTOM_NAV_CLEARANCE_PX` reserved a phantom
              // 80px gap below the composer. Web → spacing.sm only.
              //
              // Native: when the keyboard is up, this padding IS the composer's
              // position. `inputWrap` carries only paddingHorizontal/paddingTop
              // and is the last in-flow child of a flex:1 column, so its
              // paddingBottom already places the pill's BOTTOM EDGE — the pill's
              // body then extends upward from there.
              //
              // #1890 [keyboard-clearance-overshoot] — ORCH-1165 REWORK loop 2
              // added the measured `composerHeight` on top of that, which lifted
              // the pill by its own full height a SECOND time, plus a stray
              // spacing.sm. Measured on glass: 61.0pt of gap on an iPhone SE3
              // against a 12pt contract, 71.8dp on the physical Samsung. #1850
              // then correctly replaced the hand-typed 42 with DONE_BAR_OCCUPIED,
              // which removed the accidental masking and made iOS worse (49 -> 60).
              //
              // The bar's top sits keyboardHeight + DONE_BAR_OCCUPIED from the
              // bottom, so clearing it by MIN_VISIBLE_CLEARANCE is the whole job.
              // Do NOT add a measured pill height here: this padding positions
              // the pill's bottom edge, so any pill-height term is a double
              // count. When closed, clear the floating BottomNav capsule +
              // safe-area inset.
              paddingBottom:
                Platform.OS === "web"
                  ? spacing.sm
                  : keyboardHeight > 0
                    ? keyboardHeight + DONE_BAR_OCCUPIED + MIN_VISIBLE_CLEARANCE
                    : Math.max(insets.bottom, spacing.md) + BOTTOM_NAV_CLEARANCE_PX,
            },
          ]}
        >
          {suggestionsOpen && online && !recovery && !rateLimited ? (
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
          {/* #1890 — the measuring wrapper is gone with the double count it fed.
              `inputWrap`'s paddingBottom already positions this pill's bottom
              edge; nothing needs the pill's own height. */}
          {recovery ? <RecoveryPanel recovery={recovery} onAction={handleRecovery} /> : (
            <>
              {!online ? (
                <RecoveryPanel
                  recovery={{ code: "OFFLINE", title: "You're offline", body: "Reconnect to continue this plan." }}
                  onAction={() => undefined}
                />
              ) : null}
              {rateLimited ? (
                <RecoveryPanel
                  recovery={{
                    code: "RATE_LIMITED",
                    title: "You have reached today’s chat limit",
                    body: `Sending is paused. Try again in ${cooldownSeconds} ${cooldownSeconds === 1 ? "second" : "seconds"}.`,
                  }}
                  onAction={() => undefined}
                />
              ) : null}
              <InputBar
                onSend={handleSend}
                disabled={chat.isSending || brands.isLoading || rateLimited || !conversationSelectionReady}
                placeholder={!conversationSelectionReady ? "Restoring your chat…" : !online ? "Reconnect to continue…" : brands.isLoading ? "Checking brand access…" : rateLimited ? "Sending paused…" : "Ask Ari…"}
                onShowSuggestions={() => setSuggestionsOpen((v) => !v)}
              />
            </>
          )}
        </View>
      </View>

      <ConversationDrawer
        visible={drawerOpen && brandScopeStable}
        onClose={() => setDrawerOpen(false)}
        conversations={conversations.conversations}
        activeId={chat.conversationId}
        onSelect={handleSelectConversation}
        selectedBrandName={brandName}
        hasSelectedBrand={!!selectedBrandId}
        isLoading={conversations.isLoading}
        isError={conversations.isError}
        onRetry={conversations.refetch}
      />

      <BrandSwitcherSheet visible={brandSwitcherOpen} onClose={() => setBrandSwitcherOpen(false)} />

      <AiDisclosureModal
        visible={disclosureNeeded}
        onAccept={handleAcceptDisclosure}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  websiteSplitHost: { flexDirection: "row", gap: spacing.lg, padding: spacing.md },
  websiteDraftPane: {
    flex: 1.2,
    minWidth: 0,
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    justifyContent: "center",
  },
  websiteDraftLabel: {
    ...typography.micro,
    color: accent.warm,
    textTransform: "uppercase",
  },
  websiteDraftBody: { ...typography.body, color: textTokens.secondary },
  websiteDraftAction: {
    minHeight: 44,
    justifyContent: "center",
  },
  websiteDraftActionLabel: {
    ...typography.buttonMd,
    color: accent.warm,
  },
  headerEmbedded: {
    display: "none",
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
  emptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  flexSpacer: {
    flex: 1,
  },
  inputWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  suggestionsPanel: {
    marginBottom: spacing.sm,
  },
  recoveryPanel: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: Platform.OS === "android" ? ariThread.ariBubbleAndroid : glass.tint.profileElevated,
    overflow: "hidden",
    gap: spacing.sm,
  },
  recoveryTitle: { color: textTokens.primary, fontSize: 15, fontWeight: "600" },
  recoveryBody: { color: textTokens.secondary, fontSize: 14, lineHeight: 20 },
  recoveryAction: { minHeight: 44, width: "100%", alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: ariPalette.userBubble },
  recoveryActionFocused: Platform.OS === "web" ? ({ outlineWidth: 2, outlineStyle: "solid", outlineColor: ariPalette.flame, outlineOffset: 2 } as object) : {},
  recoveryActionText: { color: textTokens.inverse, fontWeight: "700", textAlign: "center" },
});

export default AriChatScreen;
