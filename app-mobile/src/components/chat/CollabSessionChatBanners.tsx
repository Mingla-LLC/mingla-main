import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import ExpandedCardModal from "../ExpandedCardModal";
import { SwipeableSessionCards } from "../board/SwipeableSessionCards";
import {
  useSessionScheduledCards,
  SessionScheduledCardRow,
} from "../../hooks/useSessionScheduledCards";
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

export interface SavedSessionCard {
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
const MATCHES_SHEET_SNAP_POINTS = ["62%", "88%"];
const PLANS_SHEET_SNAP_POINTS = ["46%", "78%"];

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

export function useSessionSavedCardsForSheet(sessionId: string | null | undefined): {
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

// META-ORCH-0991 Wave A — migrated onto BaseBottomSheet. Preserves exact
// pixel/gesture parity: light theme via per-consumer backgroundStyle (#ffffff
// + radius 24) and handleStyle (rgba(17,24,39,0.24) width 44), backdrop 0.48,
// wrapInRNModal (was wrapped in RN Modal at the old :282). Header + close stay
// identical; `scroll` lets the primitive own the BottomSheetScrollView so the
// row list scrolls without fighting the sheet pan (SC-10).
function CompactCollabBottomSheet({
  visible,
  onClose,
  title,
  closeAccessibilityLabel,
  snapPoints,
  scroll = false,
  scrollContentContainerStyle,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  closeAccessibilityLabel: string;
  snapPoints: string[];
  scroll?: boolean;
  scrollContentContainerStyle?: object;
  children: React.ReactNode;
}) {
  const header = (
    <View style={styles.compactSheetHeader}>
      <Text style={styles.compactSheetTitle} numberOfLines={1}>
        {title}
      </Text>
      <TouchableOpacity
        onPress={onClose}
        style={styles.compactSheetCloseButton}
        accessibilityRole="button"
        accessibilityLabel={closeAccessibilityLabel}
      >
        <Icon name="close-outline" size={22} color="#6b7280" />
      </TouchableOpacity>
    </View>
  );

  if (scroll) {
    return (
      <BaseBottomSheet
        visible={visible}
        onClose={onClose}
        theme="light"
        wrapInRNModal
        snapPoints={snapPoints}
        backdropOpacity={0.48}
        backgroundStyle={styles.compactSheetBackground}
        handleStyle={styles.compactSheetHandle}
        bodyContainerStyle={styles.compactSheetContent}
        accessibilityLabel={title}
        scrollMode="scroll"
        scrollProps={{
          contentContainerStyle: scrollContentContainerStyle,
          showsVerticalScrollIndicator: false,
        }}
        header={header}
      >
        {children}
      </BaseBottomSheet>
    );
  }

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      theme="light"
      wrapInRNModal
      snapPoints={snapPoints}
      backdropOpacity={0.48}
      backgroundStyle={styles.compactSheetBackground}
      handleStyle={styles.compactSheetHandle}
      bodyContainerStyle={styles.compactSheetContent}
      accessibilityLabel={title}
      scrollMode="view"
      header={header}
    >
      {children}
    </BaseBottomSheet>
  );
}

export function ScheduleSheet({ visible, onClose, sessionId }: SheetProps) {
  const { rows, isLoading, isError, refetch } =
    useSessionScheduledCards(sessionId);
  const [expandedCard, setExpandedCard] = useState<ExpandedCardData | null>(
    null,
  );

  const hasRows = !isLoading && !isError && rows.length > 0;

  return (
    <>
      <CompactCollabBottomSheet
        visible={visible}
        onClose={onClose}
        title="Plans"
        closeAccessibilityLabel="Close plans"
        snapPoints={PLANS_SHEET_SNAP_POINTS}
        scroll={hasRows}
        scrollContentContainerStyle={styles.verticalListContent}
      >
        {isLoading ? (
          <ActivityIndicator style={styles.loading} color="#eb7825" />
        ) : isError ? (
          <Pressable
            onPress={refetch}
            style={styles.emptyState}
            accessibilityRole="button"
            accessibilityLabel="Retry loading plans"
          >
            <Text style={styles.emptyText}>
              Could not load plans. Tap to retry.
            </Text>
          </Pressable>
        ) : rows.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No locked-in plans yet.</Text>
          </View>
        ) : (
          rows.map((item: SessionScheduledCardRow) => (
            <TouchableOpacity
              key={item.savedCardId}
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
          ))
        )}
      </CompactCollabBottomSheet>
      <ExpandedCardModal
        visible={!!expandedCard}
        target={
          expandedCard ? { kind: "nightOut", data: expandedCard } : null
        }
        onClose={() => setExpandedCard(null)}
        onSave={() => {}}
        currentMode="collab"
      />
    </>
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
    <>
      <CompactCollabBottomSheet
        visible={visible}
        onClose={onClose}
        title="Matches"
        closeAccessibilityLabel="Close matches"
        snapPoints={MATCHES_SHEET_SNAP_POINTS}
      >
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
      </CompactCollabBottomSheet>
      <ExpandedCardModal
        visible={!!expandedCard}
        target={
          expandedCard ? { kind: "nightOut", data: expandedCard } : null
        }
        onClose={() => setExpandedCard(null)}
        onSave={() => {}}
        currentMode="collab"
      />
    </>
  );
}

const styles = StyleSheet.create({
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
  compactSheetBackground: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  compactSheetHandle: {
    backgroundColor: "rgba(17,24,39,0.24)",
    width: 44,
  },
  compactSheetContent: {
    flex: 1,
    paddingTop: 6,
  },
  compactSheetHeader: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  compactSheetTitle: {
    flex: 1,
    color: "#111827",
    fontSize: 18,
    fontWeight: "800",
  },
  compactSheetCloseButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
  },
  savedCardsBody: { flex: 1, minHeight: 390 },
});
