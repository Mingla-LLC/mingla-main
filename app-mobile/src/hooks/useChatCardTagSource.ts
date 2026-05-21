import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../services/supabase";
import { useSavedCards } from "./useSavedCards";
import type { CardPayload } from "../services/messagingService";

export interface ChatCardTagCandidate {
  savedCardId: string;
  title: string;
  category: string | null;
  categoryIcon?: string;
  image: string | null;
  cardPayload: CardPayload;
}

interface BoardSavedCardRow {
  id: string;
  card_data: Partial<CardPayload> | null;
  saved_at?: string | null;
}

const toCandidate = (
  savedCardId: string,
  source: Partial<CardPayload> & { name?: string; images?: string[] },
): ChatCardTagCandidate => {
  const image = source.image ?? source.images?.[0] ?? null;
  const title = source.title ?? source.name ?? "Saved experience";
  return {
    savedCardId,
    title,
    category: source.category ?? null,
    categoryIcon: typeof source.categoryIcon === "string" ? source.categoryIcon : undefined,
    image,
    cardPayload: {
      ...source,
      id: source.id ?? savedCardId,
      title,
      category: source.category ?? null,
      image,
    },
  };
};

export function useChatCardTagSource(args: {
  conversationType: "direct" | "group";
  sessionId?: string | null;
  currentUserId?: string | null;
}) {
  const ownSavedCards = useSavedCards(args.currentUserId ?? undefined);

  const sessionSavedCards = useQuery<ChatCardTagCandidate[]>({
    queryKey: ["chat", "card-tags", "session", args.sessionId ?? ""],
    enabled: args.conversationType === "group" && !!args.sessionId,
    staleTime: 30_000,
    queryFn: async () => {
      if (!args.sessionId) return [];
      // board_saved_cards columns: id, session_id, experience_id, saved_experience_id,
      // card_data, saved_by, saved_at, is_locked, locked_at, locked_by_consensus.
      // No `experience_data` column — only `card_data`.
      const { data, error } = await supabase
        .from("board_saved_cards")
        .select("id, card_data, saved_at")
        .eq("session_id", args.sessionId)
        .order("saved_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      return ((data ?? []) as BoardSavedCardRow[])
        .map((row) => toCandidate(row.id, row.card_data ?? {}));
    },
  });

  const directCards = useMemo(
    () =>
      (ownSavedCards.data ?? []).map((card) =>
        toCandidate(card.id, {
          ...card,
          id: card.id,
          title: card.title,
          category: card.category,
          image: card.image,
          images: card.images,
        }),
      ),
    [ownSavedCards.data],
  );

  if (args.conversationType === "group") {
    return {
      data: sessionSavedCards.data ?? [],
      isLoading: sessionSavedCards.isLoading,
      error: sessionSavedCards.error,
    };
  }

  return {
    data: directCards,
    isLoading: ownSavedCards.isLoading,
    error: ownSavedCards.error,
  };
}
