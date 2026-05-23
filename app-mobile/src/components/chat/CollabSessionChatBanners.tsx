import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Icon } from "../ui/Icon";
import { toastManager } from "../ui/Toast";
import ExpandedCardModal from "../ExpandedCardModal";
import PreferencesSheet from "../PreferencesSheet";
import SwipeableCards from "../SwipeableCards";
import { SwipeableSessionCards } from "../board/SwipeableSessionCards";
import { RecommendationsProvider } from "../../contexts/RecommendationsContext";
import { useBoardSession } from "../../hooks/useBoardSession";
import {
  useSessionScheduledCards,
  SessionScheduledCardRow,
} from "../../hooks/useSessionScheduledCards";
import { useSessionDeckMountStore } from "../../store/sessionDeckMountStore";
import { realtimeService } from "../../services/realtimeService";
import { supabase } from "../../services/supabase";
import type { ExpandedCardData } from "../../types/expandedCardTypes";

interface Props {
  sessionId: string;
  currentUserId: string | undefined | null;
  boardsSessions?: any[];
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  onCardLike?: (card: any) => Promise<boolean>;
  onAddToCalendar?: (experienceData: any) => void;
  onShareCard?: (card: any) => void;
  onPurchaseComplete?: (experienceData: any, purchaseOption: any) => void;
}

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  sessionId: string;
  currentUserId: string | undefined | null;
}

interface SavedSessionCard {
  id: string;
  saved_card_id?: string;
  session_id: string;
  saved_by: string;
  saved_at: string;
  experience_id?: string | null;
  saved_experience_id?: string | null;
  card_data?: any;
  experience_data?: any;
}

const SAVED_CARDS_PAGE_SIZE = 20;

function cardTitle(
  cardData: Record<string, unknown> | null | undefined,
): string {
  const title = cardData?.title;
  return typeof title === "string" && title.trim() ? title : "Untitled card";
}

function cardImage(
  cardData: Record<string, unknown> | null | undefined,
): string | null {
  if (!cardData) return null;
  if (typeof cardData.image === "string" && cardData.image.length > 0)
    return cardData.image;
  if (Array.isArray(cardData.images)) {
    const first = cardData.images.find(
      (url) => typeof url === "string" && url.length > 0,
    );
    return typeof first === "string" ? first : null;
  }
  return null;
}

function useSessionSavedCardsForSheet(sessionId: string | null | undefined): {
  savedCards: SavedSessionCard[];
  isLoading: boolean;
} {
  const queryClient = useQueryClient();

  const query = useQuery<SavedSessionCard[]>({
    queryKey: ["savedCards", sessionId],
    enabled: !!sessionId,
    staleTime: 15_000,
    queryFn: async () => {
      if (!sessionId) return [];

      const { data, error } = await supabase
        .from("board_saved_cards")
        .select("*")
        .eq("session_id", sessionId)
        .eq("is_locked", false)
        .order("saved_at", { ascending: false })
        .range(0, SAVED_CARDS_PAGE_SIZE - 1);

      if (error) throw error;
      return (data ?? []) as SavedSessionCard[];
    },
  });

  const invalidateSavedCards = useCallback(() => {
    if (!sessionId) return;
    queryClient.invalidateQueries({ queryKey: ["savedCards", sessionId] });
  }, [queryClient, sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    let matchPromotedRefetchTimer: ReturnType<typeof setTimeout> | null = null;
    const callbacks = {
      onCardSaved: invalidateSavedCards,
      onCardLocked: invalidateSavedCards,
      onMatchPromoted: () => {
        if (matchPromotedRefetchTimer) return;
        matchPromotedRefetchTimer = setTimeout(() => {
          matchPromotedRefetchTimer = null;
          invalidateSavedCards();
        }, 1000);
      },
    };

    realtimeService.subscribeToBoardSession(sessionId, callbacks);
    return () => {
      realtimeService.unregisterBoardCallbacks(sessionId, callbacks);
      if (matchPromotedRefetchTimer) clearTimeout(matchPromotedRefetchTimer);
    };
  }, [invalidateSavedCards, sessionId]);

  return {
    savedCards: query.data ?? [],
    isLoading: query.isLoading,
  };
}

function toExpandedCard(
  cardData: Record<string, unknown> | null | undefined,
): ExpandedCardData | null {
  if (!cardData) return null;
  const title = cardTitle(cardData);
  const image = cardImage(cardData) ?? "";
  return {
    id: String(cardData.id ?? cardData.experience_id ?? title),
    placeId:
      typeof cardData.placeId === "string" ? cardData.placeId : undefined,
    title,
    category:
      typeof cardData.category === "string" ? cardData.category : "night_out",
    categoryIcon:
      typeof cardData.categoryIcon === "string"
        ? cardData.categoryIcon
        : "location-outline",
    description:
      typeof cardData.description === "string" ? cardData.description : "",
    fullDescription:
      typeof cardData.fullDescription === "string"
        ? cardData.fullDescription
        : typeof cardData.description === "string"
          ? cardData.description
          : "",
    image,
    images: Array.isArray(cardData.images)
      ? (cardData.images.filter((url) => typeof url === "string") as string[])
      : image
        ? [image]
        : [],
    rating: typeof cardData.rating === "number" ? cardData.rating : 0,
    reviewCount:
      typeof cardData.reviewCount === "number" ? cardData.reviewCount : 0,
    priceRange:
      typeof cardData.priceRange === "string" ? cardData.priceRange : undefined,
    distance: typeof cardData.distance === "string" ? cardData.distance : null,
    travelTime:
      typeof cardData.travelTime === "string" ? cardData.travelTime : null,
    address: typeof cardData.address === "string" ? cardData.address : "",
    highlights: Array.isArray(cardData.highlights)
      ? (cardData.highlights.filter((v) => typeof v === "string") as string[])
      : [],
    tags: Array.isArray(cardData.tags)
      ? (cardData.tags.filter((v) => typeof v === "string") as string[])
      : [],
    matchScore:
      typeof cardData.matchScore === "number" ? cardData.matchScore : 0,
    matchFactors:
      (cardData.matchFactors as ExpandedCardData["matchFactors"]) ?? {
        location: 0,
        budget: 0,
        category: 0,
        time: 0,
        popularity: 0,
      },
    socialStats: (cardData.socialStats as ExpandedCardData["socialStats"]) ?? {
      views: 0,
      likes: 0,
      saves: 0,
      shares: 0,
    },
    location: cardData.location as ExpandedCardData["location"],
    cardType: cardData.cardType === "curated" ? "curated" : undefined,
    stops: cardData.stops as ExpandedCardData["stops"],
    tagline:
      typeof cardData.tagline === "string" ? cardData.tagline : undefined,
    totalPriceMin:
      typeof cardData.totalPriceMin === "number"
        ? cardData.totalPriceMin
        : undefined,
    totalPriceMax:
      typeof cardData.totalPriceMax === "number"
        ? cardData.totalPriceMax
        : undefined,
    estimatedDurationMinutes:
      typeof cardData.estimatedDurationMinutes === "number"
        ? cardData.estimatedDurationMinutes
        : undefined,
  };
}

function formatScheduledAt(value: string): string {
  try {
    return new Date(value).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function BannerRow({
  icon,
  iconColor,
  backgroundColor,
  title,
  subtitle,
  minHeight = 48,
  accessibilityLabel,
  onPress,
}: {
  icon: string;
  iconColor: string;
  backgroundColor: string;
  title: string;
  subtitle: string;
  minHeight?: number;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={[styles.banner, { backgroundColor, minHeight }]}
    >
      <View style={[styles.iconShell, { backgroundColor: iconColor }]}>
        <Icon name={icon} size={17} color="#ffffff" />
      </View>
      <View style={styles.bannerText}>
        <Text style={styles.bannerTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.bannerSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Icon name="chevron-forward" size={20} color="#6b7280" />
    </Pressable>
  );
}

export function ScheduleSheet({ visible, onClose, sessionId }: SheetProps) {
  const { rows, isLoading, isError, refetch } =
    useSessionScheduledCards(sessionId);
  const [expandedCard, setExpandedCard] = useState<ExpandedCardData | null>(
    null,
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close locked-in plans"
        />
        <View style={styles.bottomSheet}>
          <View style={styles.handleBar} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Locked-in plans</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel="Close locked-in plans"
            >
              <Icon name="close-outline" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>
          {isLoading ? (
            <ActivityIndicator style={styles.loading} color="#eb7825" />
          ) : isError ? (
            <Pressable
              onPress={refetch}
              style={styles.emptyState}
              accessibilityRole="button"
              accessibilityLabel="Retry loading locked-in plans"
            >
              <Text style={styles.emptyText}>
                Could not load locked-in plans. Tap to retry.
              </Text>
            </Pressable>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(item) => item.savedCardId}
              contentContainerStyle={styles.verticalListContent}
              renderItem={({ item }: { item: SessionScheduledCardRow }) => (
                <TouchableOpacity
                  style={styles.scheduleRow}
                  onPress={() => setExpandedCard(toExpandedCard(item.cardData))}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${cardTitle(item.cardData)} scheduled for ${formatScheduledAt(item.scheduledAt)}`}
                >
                  <View style={styles.scheduleIcon}>
                    <Icon name="lock-closed" size={15} color="#92400e" />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {cardTitle(item.cardData)}
                    </Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {formatScheduledAt(item.scheduledAt)}
                    </Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      Locked in by {item.lockedByDisplayName || "someone"}
                    </Text>
                  </View>
                  <Icon name="chevron-forward" size={18} color="#9ca3af" />
                </TouchableOpacity>
              )}
            />
          )}
        </View>
        <ExpandedCardModal
          visible={!!expandedCard}
          target={
            expandedCard ? { kind: "nightOut", data: expandedCard } : null
          }
          onClose={() => setExpandedCard(null)}
          onSave={() => {}}
          currentMode="collab"
        />
      </View>
    </Modal>
  );
}

export function SavedToSessionCardsSheet({
  visible,
  onClose,
  sessionId,
  currentUserId,
  savedCards,
  savedCardsLoading,
  participantCount,
  accountPreferences,
  isAdmin,
}: SheetProps & {
  savedCards: SavedSessionCard[];
  savedCardsLoading: boolean;
  participantCount: number;
  accountPreferences?: Props["accountPreferences"];
  isAdmin: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [expandedCard, setExpandedCard] = useState<ExpandedCardData | null>(
    null,
  );

  const openExpandedCardModal = useCallback((card: SavedSessionCard) => {
    const expanded = toExpandedCard(
      card.card_data || card.experience_data || null,
    );
    if (expanded) setExpandedCard(expanded);
  }, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.savedCardsSheet}>
        <View
          style={[styles.deckHeader, { paddingTop: Math.max(insets.top, 8) }]}
        >
          <TouchableOpacity
            onPress={onClose}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Close saved-to-session cards"
          >
            <Icon name="chevron-down" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.deckTitle}>Saved to session</Text>
          <View style={styles.headerButton} />
        </View>
        <View style={styles.savedCardsBody}>
          <SwipeableSessionCards
            cards={savedCards}
            sessionId={sessionId}
            userId={currentUserId ?? undefined}
            participantCount={participantCount}
            onViewDetails={openExpandedCardModal}
            loading={savedCardsLoading}
            accountPreferences={accountPreferences}
            isAdmin={isAdmin}
          />
        </View>
        <ExpandedCardModal
          visible={!!expandedCard}
          target={
            expandedCard ? { kind: "nightOut", data: expandedCard } : null
          }
          onClose={() => setExpandedCard(null)}
          onSave={() => {}}
          currentMode="collab"
        />
      </SafeAreaView>
    </Modal>
  );
}

export function InChatDeckSheet({
  visible,
  onClose,
  sessionId,
  boardsSessions = [],
  accountPreferences,
  onCardLike,
  onAddToCalendar,
  onShareCard,
  onPurchaseComplete,
}: Omit<Props, "currentUserId"> & { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [showPrefsSheet, setShowPrefsSheet] = useState(false);
  const { session, preferences } = useBoardSession(sessionId);
  const release = useSessionDeckMountStore((state) => state.release);

  useEffect(() => {
    if (!visible) return;
    return () => release(sessionId);
  }, [visible, sessionId, release]);

  const scopedBoardsSessions = useMemo(() => {
    const found = boardsSessions.find(
      (s: any) => s?.id === sessionId || s?.session_id === sessionId,
    );
    return found
      ? boardsSessions
      : [
          {
            id: sessionId,
            session_id: sessionId,
            name: session?.name || sessionId,
          },
          ...boardsSessions,
        ];
  }, [boardsSessions, session?.name, sessionId]);

  const close = useCallback(() => {
    setShowPrefsSheet(false);
    release(sessionId);
    onClose();
  }, [onClose, release, sessionId]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={close}
    >
      <SafeAreaView style={styles.deckSheet}>
        <View
          style={[styles.deckHeader, { paddingTop: Math.max(insets.top, 8) }]}
        >
          <TouchableOpacity
            onPress={close}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Close swipe cards deck"
          >
            <Icon name="chevron-down" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.deckTitle}>Swipe cards</Text>
          <TouchableOpacity
            onPress={() => setShowPrefsSheet(true)}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Open session preferences"
          >
            <Icon name="settings-outline" size={22} color="#111827" />
          </TouchableOpacity>
        </View>
        <View style={styles.deckBody} key={sessionId}>
          <RecommendationsProvider currentMode={sessionId} key={sessionId}>
            <SwipeableCards
              key={sessionId}
              sessionIdOverride={sessionId}
              userPreferences={preferences}
              accountPreferences={accountPreferences}
              currentMode="collab"
              boardsSessions={scopedBoardsSessions}
              onCardLike={onCardLike || (async () => false)}
              onAddToCalendar={onAddToCalendar}
              onShareCard={onShareCard}
              onPurchaseComplete={onPurchaseComplete}
              onOpenCollabPreferences={() => setShowPrefsSheet(true)}
            />
          </RecommendationsProvider>
        </View>
        <PreferencesSheet
          visible={showPrefsSheet}
          onClose={() => setShowPrefsSheet(false)}
          accountPreferences={accountPreferences}
          sessionId={sessionId}
          sessionName={session?.name}
        />
      </SafeAreaView>
    </Modal>
  );
}

export function CollabSessionChatBanners({
  sessionId,
  currentUserId,
  boardsSessions,
  accountPreferences,
  onCardLike,
  onAddToCalendar,
  onShareCard,
  onPurchaseComplete,
}: Props) {
  const [showScheduleSheet, setShowScheduleSheet] = useState(false);
  const [showLikedSheet, setShowLikedSheet] = useState(false);
  const [showDeckSheet, setShowDeckSheet] = useState(false);
  const scheduled = useSessionScheduledCards(sessionId);
  const { session, isAdmin } = useBoardSession(sessionId);
  const participants = (session?.participants || []) as any[];
  const { savedCards: savedCardsForLikesSheet, isLoading: savedCardsLoading } =
    useSessionSavedCardsForSheet(sessionId);
  const acquire = useSessionDeckMountStore((state) => state.acquire);

  const openDeck = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!acquire(sessionId, "in-chat-sheet")) {
      toastManager.show(
        "Deck open elsewhere — close it to swipe from chat.",
        "warning",
        3000,
      );
      return;
    }
    setShowDeckSheet(true);
  }, [acquire, sessionId]);

  return (
    <View style={styles.stack} testID="collab-session-chat-banners">
      {scheduled.rows.length > 0 ? (
        <BannerRow
          icon="lock-closed"
          iconColor="#d97706"
          backgroundColor="#FEF3C7"
          title="Locked-in plans"
          subtitle={`${scheduled.rows.length} scheduled`}
          accessibilityLabel={`Locked-in plans: ${scheduled.rows.length} scheduled. Tap to view.`}
          onPress={async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowScheduleSheet(true);
          }}
        />
      ) : null}
      {savedCardsForLikesSheet.length > 0 ? (
        <BannerRow
          icon="heart-outline"
          iconColor="#db2777"
          backgroundColor="#FCE7F3"
          title="Saved to session"
          subtitle={`${savedCardsForLikesSheet.length} cards saved`}
          accessibilityLabel={`Saved to session: ${savedCardsForLikesSheet.length} cards saved. Tap to view.`}
          onPress={async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowLikedSheet(true);
          }}
        />
      ) : null}
      <BannerRow
        icon="albums-outline"
        iconColor="#ea580c"
        backgroundColor="#FED7AA"
        title="Swipe cards together"
        subtitle="Tap to open the deck"
        minHeight={56}
        accessibilityLabel="Open swipeable deck for this session."
        onPress={openDeck}
      />
      <ScheduleSheet
        visible={showScheduleSheet}
        onClose={() => setShowScheduleSheet(false)}
        sessionId={sessionId}
        currentUserId={currentUserId}
      />
      <SavedToSessionCardsSheet
        visible={showLikedSheet}
        onClose={() => setShowLikedSheet(false)}
        sessionId={sessionId}
        currentUserId={currentUserId}
        savedCards={savedCardsForLikesSheet}
        savedCardsLoading={savedCardsLoading}
        participantCount={participants.length}
        accountPreferences={accountPreferences}
        isAdmin={isAdmin}
      />
      <InChatDeckSheet
        visible={showDeckSheet}
        onClose={() => setShowDeckSheet(false)}
        sessionId={sessionId}
        boardsSessions={boardsSessions}
        accountPreferences={accountPreferences}
        onCardLike={onCardLike}
        onAddToCalendar={onAddToCalendar}
        onShareCard={onShareCard}
        onPurchaseComplete={onPurchaseComplete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 4,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  iconShell: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  bannerText: { flex: 1, minWidth: 0 },
  bannerTitle: { color: "#111827", fontSize: 14, fontWeight: "700" },
  bannerSubtitle: {
    color: "#6b7280",
    fontSize: 12,
    fontWeight: "500",
    marginTop: 1,
  },
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17,24,39,0.32)",
  },
  bottomSheet: {
    maxHeight: "72%",
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 18,
  },
  handleBar: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
    marginTop: 10,
    marginBottom: 8,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  loading: { paddingVertical: 28 },
  emptyState: {
    paddingHorizontal: 18,
    paddingVertical: 28,
    alignItems: "center",
  },
  emptyText: { color: "#6b7280", fontSize: 14, textAlign: "center" },
  verticalListContent: { paddingHorizontal: 14, paddingBottom: 12, gap: 8 },
  scheduleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#fde68a",
    backgroundColor: "#fffbeb",
    borderRadius: 8,
    padding: 12,
  },
  scheduleIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#fde68a",
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, minWidth: 0 },
  cardTitle: { color: "#111827", fontSize: 14, fontWeight: "700" },
  cardMeta: { color: "#6b7280", fontSize: 12, marginTop: 2 },
  savedCardsSheet: { flex: 1, backgroundColor: "#ffffff" },
  savedCardsBody: { flex: 1 },
  deckSheet: { flex: 1, backgroundColor: "#ffffff" },
  deckHeader: {
    minHeight: 56,
    paddingHorizontal: 10,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  deckTitle: {
    flex: 1,
    textAlign: "center",
    color: "#111827",
    fontSize: 17,
    fontWeight: "700",
  },
  deckBody: { flex: 1 },
});
