/**
 * EventGuestListSheet — ORCH-1341 [guest-list-sheet-consumer] (META-ORCH-1337).
 * Contract: Mingla_Artifacts/specs/SPEC_ORCH-1341_GUEST_LIST_SHEET.md §4.3–§4.5;
 * pixel design: DESIGN_META-ORCH-1337_GUEST_SOCIAL_PROOF.md §2.
 *
 * The consumer "Who's going" roster sheet — the destination of the ORCH-1340
 * `onSeeWhosGoing` affordance on all three consumer detail screens. Named rows
 * where privacy allows (D1), anonymous rows otherwise, per-row Add-friend
 * (open) + Message (ORCH-0993 friend-gated, D4) inline actions.
 *
 * LOAD-BEARING postures (do NOT re-litigate here):
 *   - EventAudienceSheet posture (MessageInterface.tsx exemplar): BaseBottomSheet
 *     `wrapInRNModal` + `theme="dark"` (app-chrome surface, NEVER palette-themed)
 *     + fixed GUEST_LIST_SNAP ['70%'] single detent (ORCH-1138 — no dynamic
 *     sizing inside an RN-Modal wrap) + stock motion (ORCH-1064 — no
 *     animationConfigs) + #111418 canvas + `scrollMode="scroll"` with the
 *     PINNED intrinsic-height `header` sibling slot above the primitive-owned
 *     BottomSheetScrollView body and mapped rows — the exemplar's exact
 *     mechanics (MessageInterface.tsx:2221-2299). REVIEW ruling (ORCH-1341):
 *     the title must never scroll away; flatlist mode folds `header` into
 *     ListHeaderComponent, so scroll mode is the pinned-header path. Rows are
 *     RPC-capped ≤100 (design §2.1 scale) — mapped rows, no virtualization
 *     needed, no raw RN list (the primitive owns the one scroll container).
 *   - COMMS-0084 / ORCH-1315: NO second RN <Modal> ever. Anything that must
 *     layer above this sheet uses the BaseBottomSheet `overlay` slot (unused in
 *     v1 — nothing layers above).
 *   - SEALED: rows are NOT pressable — the ONLY interactive elements are the
 *     two inline action buttons (I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY).
 *     Profile-open from a row is explicitly excluded (modal-over-modal footgun).
 *   - SEALED: Message navigation closes the sheet BEFORE navigating
 *     (I-PROPOSED-1341-MESSAGE-CLOSE-BEFORE-NAVIGATE). Binding order is
 *     ensure → close → navigate (SPEC §4.5 — the ensure failure needs the open
 *     sheet as its error surface); landing rides the shell's open-DM rail
 *     (openDirectMessageInApp → the Discover-map Message idiom:
 *     setPendingOpenDmUserId + page 'connections'), never a second parser and
 *     never Linking.openURL (P1-2: `mingla://` is not a registered scheme —
 *     the app's scheme is com.mingla.app.v2 — and `chat` has no expo-router
 *     file route, so an openURL default dead-ends).
 *   - Anonymous rows carry no profileId (D8) and expose NO actions — an action
 *     on an anonymous row would deanonymize it.
 *   - Blocked pairs are excluded SERVER-side (1338 SC-6) — this file contains
 *     no block/visibility filtering and never imports blockService (T-8).
 *   - connectionsService is BANNED (F-13 legacy half-stub) — zero imports.
 *   - Skeleton pulse loop carries `isInteraction: false` (ORCH-1303 — a loop
 *     must never hold an InteractionManager handle).
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { PeerGuestRow } from "@mingla/offering-rendering";

import { BaseBottomSheet } from "./ui/BaseBottomSheet";
import GuestProfilePeek from "./GuestProfilePeek";
import { Icon } from "./ui/Icon";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { colors } from "../constants/designSystem";
import { HapticFeedback } from "../utils/hapticFeedback";
import { useAppStore } from "../store/appStore";
import { useFriends } from "../hooks/useFriends";
import { useEventGuestList } from "../hooks/useEventGuestList";
import {
  hasOpenDirectMessageSink,
  openDirectMessageInApp,
} from "../services/deepLinkService";
import { GuestListGatedError } from "../services/socialProofService";
import { messagingService } from "../services/messagingService";

// Fixed single detent — EventAudienceSheet precedent (MessageInterface.tsx:96).
// NO enableDynamicSizing (ORCH-1138 mismeasure class inside an RN-Modal wrap).
const GUEST_LIST_SNAP = ["70%"];

const SKELETON_ROWS = 6;
const HINT_FADE_IN_MS = 120;
const HINT_HOLD_MS = 2500;
const HINT_FADE_OUT_MS = 200;

export interface EventGuestListSheetProps {
  visible: boolean;
  /** ALL dismiss analytics (if ever added) live here — never on a button. */
  onClose: () => void;
  eventId: string | null;
  /**
   * The honest total from the host's momentum data — feeds the header
   * subtitle and the "and N more" capped-tail math (partySize seats beyond
   * the row cap live honestly inside this arithmetic — D3).
   */
  goingCount: number;
  /**
   * Optional override seam for tests/future hosts. Absent ⇒ the default
   * in-app rail: openDirectMessageInApp(profileId) — the shell's open-DM
   * sink riding the Discover-map Message idiom (P1-2: never Linking.openURL).
   */
  onOpenConversation?: (conversationId: string) => void;
}

type GuestDisplayRow = {
  key: string;
  guest: PeerGuestRow;
  isNamed: boolean;
  isYou: boolean;
};

type SheetPhase = "skeleton" | "content" | "empty" | "gated" | "error";

/** First letters of the first + last words, uppercased (exemplar initials idiom). */
const initialsFor = (name: string): string => {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "?";
  const parts = trimmed.split(/\s+/);
  const first = parts[0]?.charAt(0) ?? "";
  const second =
    parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  const joined = `${first}${second}`.toUpperCase();
  return joined.length > 0 ? joined : "?";
};

export function EventGuestListSheet({
  visible,
  onClose,
  eventId,
  goingCount,
  onOpenConversation,
}: EventGuestListSheetProps): React.ReactElement {
  const viewerId = useAppStore((s) => s.user?.id);
  const { page, isLoading, isError, error, refetch } = useEventGuestList(
    eventId,
    visible,
  );
  // Cross-refs for the action state machines. addFriend THROWS on failure
  // (useFriends.ts) and already invalidates friendsKeys.requests on success —
  // no extra cache work here. blocked-users auto-fetch is skipped: the server
  // owns ALL block exclusion (SPEC §4.4) and this sheet must never hold block
  // data it is forbidden to act on.
  const { friends, friendRequests, addFriend } = useFriends({
    autoFetchBlockedUsers: false,
  });

  // ── reduce-motion (OS setting — trip-screen idiom) ─────────────────────────
  const [reduceMotion, setReduceMotion] = useState<boolean>(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduceMotion(value);
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value: boolean) => setReduceMotion(value),
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  // ORCH-1358 — the in-sheet profile peek. Tapping a NAMED row swaps the sheet
  // body (guest list ⇄ GuestProfilePeek) inside the SAME RN Modal — never a
  // second modal (the META-ORCH-1337 overlay-slot resolution). Holds the target
  // profileId + a fallback name for the peek's loading state; null = list shown.
  const [overlayProfile, setOverlayProfile] = useState<{
    id: string;
    name: string;
  } | null>(null);
  // ORCH-1358 — reset the peek whenever the sheet is dismissed, so a reopen
  // always lands on the guest list (never a stale profile from last time).
  useEffect(() => {
    if (!visible) setOverlayProfile(null);
  }, [visible]);

  // ── per-row action state ───────────────────────────────────────────────────
  const [addStates, setAddStates] = useState<
    Record<string, "inflight" | "requested">
  >({});
  const [messageInflight, setMessageInflight] = useState<
    Record<string, boolean>
  >({});

  // ── transient line-2 hint (DESIGN §2.5 microcopy mechanism — no toasts) ────
  const [hint, setHint] = useState<{ key: string; text: string } | null>(null);
  const hintOpacity = useRef(new Animated.Value(0)).current;
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHintTimer = (): void => {
    if (hintTimer.current !== null) {
      clearTimeout(hintTimer.current);
      hintTimer.current = null;
    }
  };
  const showHint = useCallback(
    (key: string, text: string): void => {
      clearHintTimer();
      setHint({ key, text });
      if (reduceMotion) {
        // Instant swap/restore, same hold (DESIGN §2.5 reduced-motion rule).
        hintOpacity.setValue(1);
        hintTimer.current = setTimeout(() => {
          hintOpacity.setValue(0);
          setHint(null);
        }, HINT_HOLD_MS);
        return;
      }
      hintOpacity.setValue(0);
      Animated.timing(hintOpacity, {
        toValue: 1,
        duration: HINT_FADE_IN_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
        isInteraction: false,
      }).start();
      hintTimer.current = setTimeout(() => {
        Animated.timing(hintOpacity, {
          toValue: 0,
          duration: HINT_FADE_OUT_MS,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
          isInteraction: false,
        }).start(({ finished }) => {
          if (finished) setHint(null);
        });
      }, HINT_HOLD_MS + HINT_FADE_IN_MS);
    },
    [reduceMotion, hintOpacity],
  );
  useEffect(() => clearHintTimer, []);

  // Reset transient per-open state when the sheet closes (the query itself is
  // torn down by gcTime 0 + enabled:false — fresh skeleton on every open).
  useEffect(() => {
    if (!visible) {
      setAddStates({});
      setMessageInflight({});
      setHint(null);
      hintOpacity.setValue(0);
      clearHintTimer();
    }
  }, [visible, hintOpacity]);

  // ── display rows (pure display sort — never privacy; SPEC §4.3 bands) ──────
  const rows = useMemo<GuestDisplayRow[]>(() => {
    const guests = page?.guests ?? [];
    const decorated = guests.map((guest, index) => {
      // Named ⇔ profileId present (D8) and not anonymous (belt-and-braces).
      const isNamed = guest.profileId !== null && !guest.isAnonymous;
      const isYou = isNamed && guest.profileId === viewerId;
      const hasPhoto = (guest.avatarUrl ?? "").length > 0;
      const band = isYou
        ? 0
        : isNamed && hasPhoto
          ? 1
          : isNamed
            ? 2
            : !guest.isMinglaUser
              ? 3
              : 4;
      return {
        key: guest.profileId ?? `anon-${index}`,
        guest,
        isNamed,
        isYou,
        band,
        index,
      };
    });
    // Stable within a band (payload order = server recency).
    decorated.sort((a, b) =>
      a.band !== b.band ? a.band - b.band : a.index - b.index,
    );
    return decorated.map(({ key, guest, isNamed, isYou }) => ({
      key,
      guest,
      isNamed,
      isYou,
    }));
  }, [page, viewerId]);

  // ── phase (all five DESIGN §2.7 states) ────────────────────────────────────
  const phase: SheetPhase = isLoading
    ? "skeleton"
    : isError
      ? error instanceof GuestListGatedError
        ? "gated"
        : "error"
      : rows.length === 0
        ? "empty"
        : "content";

  // ── skeleton pulse — ONE shared opacity loop, isInteraction:false ──────────
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (!visible || phase !== "skeleton") return undefined;
    if (reduceMotion) {
      pulse.setValue(0.7); // static (DESIGN §2.7)
      return undefined;
    }
    pulse.setValue(0.5);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(pulse, {
          toValue: 0.5,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, phase, reduceMotion, pulse]);

  // ── skeleton→content/empty/error 150ms ease-out fade (reduced: instant) ────
  const bodyOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!visible || phase === "skeleton") return;
    if (reduceMotion) {
      bodyOpacity.setValue(1);
      return;
    }
    bodyOpacity.setValue(0);
    Animated.timing(bodyOpacity, {
      toValue: 1,
      duration: 150,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
      isInteraction: false,
    }).start();
  }, [visible, phase, reduceMotion, bodyOpacity]);

  // ── actions ────────────────────────────────────────────────────────────────
  const handleAddFriendPress = useCallback(
    async (row: GuestDisplayRow): Promise<void> => {
      const profileId = row.guest.profileId;
      if (profileId === null) return; // anonymous rows expose no actions (D8)
      HapticFeedback.medium();
      setAddStates((prev) => ({ ...prev, [row.key]: "inflight" }));
      try {
        // Exact useFriends().addFriend signature — the UUID path resolves the
        // profile server-side; "" receiverEmail is correct on this path.
        await addFriend(profileId, "", row.guest.username ?? undefined);
        setAddStates((prev) => ({ ...prev, [row.key]: "requested" }));
      } catch {
        setAddStates((prev) => {
          const next = { ...prev };
          delete next[row.key];
          return next;
        });
        showHint(row.key, "Couldn't send — try again");
      }
    },
    [addFriend, showHint],
  );

  const handleMessagePress = useCallback(
    async (row: GuestDisplayRow, isFriendRow: boolean): Promise<void> => {
      const profileId = row.guest.profileId;
      if (profileId === null) return; // anonymous rows expose no actions (D8)
      if (!isFriendRow) {
        // ORCH-0993/D4 — the friend gate is KEPT; the hint teaches the unlock.
        showHint(row.key, "Add them as a friend to message");
        return;
      }
      if (viewerId === undefined) {
        showHint(row.key, "Couldn't send — try again");
        return;
      }
      HapticFeedback.medium();
      setMessageInflight((prev) => ({ ...prev, [row.key]: true }));
      const { conversationId, error: ensureError } =
        await messagingService.ensureConversation(viewerId, profileId);
      setMessageInflight((prev) => {
        const next = { ...prev };
        delete next[row.key];
        return next;
      });
      if (ensureError !== null || conversationId === null) {
        // The sheet STAYS OPEN — a closed sheet has no error surface (§4.5).
        showHint(row.key, "Couldn't send — try again");
        return;
      }
      // SEALED close-before-NAVIGATE: dismiss the sheet FIRST, then ride the
      // shell's open-DM rail (the Discover-map Message idiom —
      // setPendingOpenDmUserId + page 'connections' → MessageInterface opens
      // the thread same-frame, resolving the conversation ensureConversation
      // just created via its cold-start DB fallback). P1-2 REWORK
      // (META-ORCH-1337 SC-R): NEVER Linking.openURL here — `mingla://` is
      // not a registered scheme (app scheme: com.mingla.app.v2) and `chat`
      // has no expo-router file route, so an openURL default dead-ends with
      // "Unable to open URL" and the DM never opens.
      if (onOpenConversation !== undefined) {
        onClose();
        onOpenConversation(conversationId);
        return;
      }
      if (!hasOpenDirectMessageSink()) {
        // No shell sink (detached/test mount) — the OPEN sheet is the error
        // surface (§4.5); closing first would strand the user on the detail.
        showHint(row.key, "Couldn't open the chat — try again");
        return;
      }
      onClose();
      openDirectMessageInApp(profileId);
    },
    [viewerId, onClose, onOpenConversation, showHint],
  );

  // ── row rendering ──────────────────────────────────────────────────────────
  const [photoErrorKeys, setPhotoErrorKeys] = useState<Record<string, boolean>>(
    {},
  );

  const renderAvatar = (row: GuestDisplayRow): React.ReactElement => {
    const { guest } = row;
    const hasPhoto =
      (guest.avatarUrl ?? "").length > 0 && photoErrorKeys[row.key] !== true;
    if (row.isNamed && hasPhoto) {
      return (
        <ImageWithFallback
          source={{ uri: guest.avatarUrl ?? "" }}
          style={styles.avatarPhoto}
          onError={() =>
            setPhotoErrorKeys((prev) => ({ ...prev, [row.key]: true }))
          }
        />
      );
    }
    if (row.isNamed) {
      // Initials disk — decorative (the adjacent name carries the info).
      const name = guest.displayName ?? guest.username ?? "Guest";
      return (
        <View style={styles.avatarInitials}>
          <Text style={styles.avatarInitialsText}>{initialsFor(name)}</Text>
        </View>
      );
    }
    // Unlinked + anonymous share the glyph disk (private ≡ no-photo — D1).
    return (
      <View style={styles.avatarGlyph}>
        <Icon name="person-outline" size={20} color="rgba(255, 255, 255, 0.55)" />
      </View>
    );
  };

  const renderGuestRow = useCallback(
    ({ item }: { item: GuestDisplayRow }): React.ReactElement => {
      const { guest } = item;
      const name = guest.displayName ?? guest.username ?? "Guest";
      const line1 = item.isNamed ? name : guest.isMinglaUser ? "Someone" : "Guest";
      // ORCH-1358 — the persistent @username / "On Mingla" subtitle is REMOVED
      // (name only). The transient rowHint keeps line 2's slot for action errors.
      const rowHint = hint !== null && hint.key === item.key ? hint.text : null;
      // ORCH-1358 — a NAMED row (has a real profileId) taps to its public-profile
      // peek; anonymous/private rows have no profileId and stay non-pressable
      // (deanonymization guard preserved).
      const openable = item.isNamed && guest.profileId !== null;

      const isFriendRow =
        item.isNamed &&
        guest.profileId !== null &&
        friends.some((f) => f.friend_user_id === guest.profileId);
      const hasPendingOutgoing =
        item.isNamed &&
        guest.profileId !== null &&
        friendRequests.some(
          (r) =>
            r.status === "pending" &&
            r.sender_id === viewerId &&
            r.receiver_id === guest.profileId,
        );
      const addState = addStates[item.key];
      const showRequestedChip = addState === "requested" || hasPendingOutgoing;
      // SEALED: actions on NAMED, non-You rows only. Anonymous/unlinked/You rows
      // expose NO actions (deanonymization guard + nothing to do with yourself).
      const showActions = item.isNamed && !item.isYou;
      const showAddFriend = showActions && !isFriendRow;
      const msgInflight = messageInflight[item.key] === true;

      const a11yLabel = openable
        ? `${name}, view profile`
        : item.isYou
          ? `${name}, you`
          : item.isNamed
            ? `${name}, on Mingla`
            : guest.isMinglaUser
              ? "Someone"
              : "Guest";

      const tapZoneInner = (
        <>
          {renderAvatar(item)}
          <View style={styles.rowCopy}>
            <Text style={styles.rowName} numberOfLines={1} ellipsizeMode="tail">
              {line1}
            </Text>
            {rowHint !== null ? (
              <Animated.Text
                style={[styles.rowHint, { opacity: hintOpacity }]}
                numberOfLines={1}
              >
                {rowHint}
              </Animated.Text>
            ) : null}
          </View>
        </>
      );

      return (
        // ORCH-1358 — a NAMED row is a Pressable tap-zone that opens the in-sheet
        // public-profile peek (swaps the sheet body — NEVER a second RN Modal).
        // The trailing action buttons live OUTSIDE the tap-zone so they still
        // fire independently. Anonymous/private rows stay a plain, non-pressable
        // View (deanonymization guard).
        <Animated.View
          key={item.key}
          style={[styles.row, { opacity: bodyOpacity }]}
          testID={`orch-1341-guest-sheet-row-${item.key}`}
        >
          {openable ? (
            <Pressable
              style={styles.rowTapZone}
              onPress={() => {
                HapticFeedback.light();
                setOverlayProfile({ id: guest.profileId as string, name });
              }}
              accessibilityRole="button"
              accessibilityLabel={a11yLabel}
              testID={`orch-1358-guest-sheet-open-profile-${item.key}`}
            >
              {tapZoneInner}
            </Pressable>
          ) : (
            <View
              style={styles.rowTapZone}
              accessible
              accessibilityLabel={a11yLabel}
            >
              {tapZoneInner}
            </View>
          )}
          {showActions ? (
            <View style={styles.actionZone}>
              {showAddFriend ? (
                showRequestedChip ? (
                  <View
                    style={styles.requestedChip}
                    accessibilityLabel={`Friend request sent to ${name}`}
                    accessibilityState={{ disabled: true }}
                    testID={`orch-1341-guest-sheet-requested-${item.key}`}
                  >
                    <Text style={styles.requestedChipText}>Requested</Text>
                  </View>
                ) : addState === "inflight" ? (
                  <View style={[styles.actionButton, styles.actionButtonAccent]}>
                    <ActivityIndicator size="small" color="#f97316" />
                  </View>
                ) : (
                  <Pressable
                    onPress={() => void handleAddFriendPress(item)}
                    hitSlop={4}
                    style={({ pressed }) => [
                      styles.actionButton,
                      styles.actionButtonAccent,
                      pressed ? styles.actionPressed : null,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${name} as a friend`}
                    testID={`orch-1341-guest-sheet-add-friend-${item.key}`}
                  >
                    <Icon name="person-add-outline" size={20} color="#f97316" />
                  </Pressable>
                )
              ) : null}
              {msgInflight ? (
                <View style={[styles.actionButton, styles.actionButtonAccent]}>
                  <ActivityIndicator size="small" color="#f97316" />
                </View>
              ) : (
                <Pressable
                  onPress={() => void handleMessagePress(item, isFriendRow)}
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.actionButton,
                    isFriendRow
                      ? styles.actionButtonAccent
                      : styles.actionButtonLocked,
                    pressed ? styles.actionPressed : null,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${name}`}
                  accessibilityHint={
                    isFriendRow ? undefined : "Available once you're friends"
                  }
                  testID={`orch-1341-guest-sheet-message-${item.key}`}
                >
                  <Icon
                    name="chatbubble-outline"
                    size={20}
                    color={isFriendRow ? "#f97316" : "rgba(255, 255, 255, 0.28)"}
                  />
                </Pressable>
              )}
            </View>
          ) : null}
        </Animated.View>
      );
    },
    // renderAvatar is stable within a render; deps below cover its inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      hint,
      hintOpacity,
      friends,
      friendRequests,
      viewerId,
      addStates,
      messageInflight,
      photoErrorKeys,
      bodyOpacity,
      handleAddFriendPress,
      handleMessagePress,
    ],
  );

  // ── empty-slot states (skeleton / gated / zero / error — DESIGN §2.7) ──────
  const renderEmptyState = (): React.ReactElement => {
    if (phase === "skeleton") {
      return (
        <View testID="orch-1341-guest-sheet-skeleton">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <Animated.View key={i} style={[styles.row, { opacity: pulse }]}>
              <View style={styles.skeletonAvatar} />
              <View style={styles.rowCopy}>
                <View style={styles.skeletonName} />
                <View style={styles.skeletonSub} />
              </View>
            </Animated.View>
          ))}
        </View>
      );
    }
    if (phase === "gated") {
      // An EMPTY state, not an error — closing the sheet is the action.
      return (
        <Animated.View
          style={[styles.stateBlock, { opacity: bodyOpacity }]}
          testID="orch-1341-guest-sheet-empty"
        >
          <Icon
            name="lock-closed"
            size={28}
            color="rgba(255, 255, 255, 0.35)"
          />
          <Text style={styles.stateTitle}>This guest list is private</Text>
          <Text style={styles.stateBody}>
            The host keeps it just for the guests.
          </Text>
        </Animated.View>
      );
    }
    if (phase === "error") {
      return (
        <Animated.View
          style={[styles.stateBlock, { opacity: bodyOpacity }]}
          testID="orch-1341-guest-sheet-error"
        >
          <Text style={styles.stateTitle}>Couldn't load the guest list</Text>
          <Text style={styles.stateBody}>Give it another go.</Text>
          <Pressable
            onPress={refetch}
            style={({ pressed }) => [
              styles.retryPill,
              pressed ? styles.actionPressed : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Retry"
            testID="orch-1341-guest-sheet-error-retry"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </Animated.View>
      );
    }
    // phase === "empty" — zero guests (race: last guest withdrew).
    return (
      <Animated.View
        style={[styles.stateBlock, { opacity: bodyOpacity }]}
        testID="orch-1341-guest-sheet-empty"
      >
        <Text style={styles.stateTitle}>No one yet</Text>
        <Text style={styles.stateBody}>Someone has to be first.</Text>
      </Animated.View>
    );
  };

  // Cap tail (DESIGN §2.6): honest reconciliation between the header count and
  // the row-capped list; no "load more" (the cap is a scrape guard, not a
  // pagination seam — F-8; no offset-walking in v1).
  const moreCount = goingCount - rows.length;
  const listFooter =
    phase === "content" && moreCount > 0 ? (
      <Animated.View
        style={[styles.footerMore, { opacity: bodyOpacity }]}
        testID="orch-1341-guest-sheet-footer-more"
      >
        <Text style={styles.footerMoreText}>{`and ${moreCount} more`}</Text>
      </Animated.View>
    ) : null;

  const header = (
    <View style={styles.header} testID="orch-1341-guest-sheet">
      <View style={styles.headerIconShell}>
        <Icon name="people" size={18} color="#ffffff" />
      </View>
      <View style={styles.headerCopy}>
        <Text style={styles.headerTitle} accessibilityRole="header">
          Who's going
        </Text>
        <Text style={styles.headerSubtitle}>{`${goingCount} going`}</Text>
      </View>
    </View>
  );

  // REVIEW ruling (ORCH-1341 amendment): `header` must be the PINNED
  // intrinsic-height sibling above the scroll body (the exemplar's mechanics —
  // the title never scrolls away). scroll mode's `<>{header}{scroll}</>`
  // branch is the primitive's supported pinned-header path; flatlist mode
  // would fold the header into ListHeaderComponent (scrolls with content).
  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={GUEST_LIST_SNAP}
      wrapInRNModal
      theme="dark"
      scrollMode="scroll"
      backgroundStyle={styles.guestSheetBackground}
      accessibilityLabel="Who's going"
      // ORCH-1358 — the peek owns its own top area (a "Guest list" back button),
      // so hide the "Who's going" header while a profile is open.
      header={overlayProfile !== null ? undefined : header}
      scrollProps={{
        contentContainerStyle: styles.listContent,
        showsVerticalScrollIndicator: false,
      }}
    >
      {overlayProfile !== null ? (
        <GuestProfilePeek
          userId={overlayProfile.id}
          fallbackName={overlayProfile.name}
          onBack={() => setOverlayProfile(null)}
        />
      ) : phase === "content" ? (
        <>
          {rows.map((item) => renderGuestRow({ item }))}
          {listFooter}
        </>
      ) : (
        renderEmptyState()
      )}
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  // Exemplar parity — MessageInterface.tsx eventAudienceSheetBackground.
  guestSheetBackground: {
    backgroundColor: "#111418",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  headerIconShell: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary[500],
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#ffffff",
  },
  headerSubtitle: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.58)",
  },
  // Horizontal inset lives on the ROWS/footer/states, NOT the scroll content
  // container (exemplar parity: eventAudienceListInner owns the inset while
  // eventAudienceListContent carries only the vertical padding).
  listContent: {
    paddingTop: 10,
    paddingBottom: 24,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 64,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.06)",
  },
  // ORCH-1358 — the tappable zone (avatar + name + the empty space up to the
  // action buttons). Flexes so the WHOLE row minus the trailing actions opens
  // the profile; the action buttons sit outside it and keep their own taps.
  rowTapZone: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  avatarPhoto: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.32)",
  },
  avatarInitials: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eb7825",
  },
  avatarInitialsText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#ffffff",
  },
  avatarGlyph: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.10)",
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
    marginRight: 10,
  },
  rowName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#f8fafc",
  },
  rowSub: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.48)",
  },
  rowHint: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.72)",
  },
  actionZone: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtonAccent: {
    backgroundColor: "rgba(249, 115, 22, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(249, 115, 22, 0.35)",
  },
  actionButtonLocked: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  actionPressed: {
    transform: [{ scale: 0.96 }],
    opacity: 0.85,
  },
  requestedChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  requestedChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.55)",
  },
  skeletonAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  skeletonName: {
    width: 120,
    height: 12,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  skeletonSub: {
    marginTop: 8,
    width: 80,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  stateBlock: {
    alignItems: "center",
    paddingVertical: 28,
    paddingHorizontal: 36,
  },
  stateTitle: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: "700",
    color: "#ffffff",
    textAlign: "center",
  },
  stateBody: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
    color: "rgba(255, 255, 255, 0.56)",
    textAlign: "center",
  },
  retryPill: {
    marginTop: 14,
    minHeight: 44,
    paddingHorizontal: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary[500],
  },
  retryText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
  },
  footerMore: {
    paddingVertical: 16,
    alignItems: "center",
  },
  footerMoreText: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.48)",
  },
});

export default EventGuestListSheet;
