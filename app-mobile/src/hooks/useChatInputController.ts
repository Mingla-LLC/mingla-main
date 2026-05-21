import { useCallback, useMemo, useRef, useState } from "react";
import type {
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
  TextInputSelectionChangeEventData,
} from "react-native";
import { Alert } from "react-native";
import type { MentionEntry, CardTagEntry } from "../services/messagingService";
import { trimCardPayload } from "../services/messagingService";
import type { ChatParticipant } from "./useConversationParticipants";
import type { ChatCardTagCandidate } from "./useChatCardTagSource";

export interface ChipRange {
  type: "mention" | "card";
  refId: string;
  displayLabel: string;
  start: number;
  end: number;
}

export interface ActiveChatPopover {
  type: "mention" | "card";
  searchText: string;
  triggerIndex: number;
}

const MAX_MENTIONS = 10;
const MAX_CARD_TAGS = 5;

const triggerFor = (type: ChipRange["type"]): "@" | "#" =>
  type === "mention" ? "@" : "#";

const findTrigger = (text: string): ActiveChatPopover | null => {
  const match = /(?:^|\s)([@#])([^\s@#]*)$/.exec(text);
  if (!match || match.index < 0) return null;
  const triggerIndex = match.index + match[0].indexOf(match[1]);
  return {
    type: match[1] === "@" ? "mention" : "card",
    searchText: match[2] ?? "",
    triggerIndex,
  };
};

const removeChipAtDeletion = (
  previousText: string,
  nextText: string,
  ranges: ChipRange[],
): { text: string; ranges: ChipRange[] } | null => {
  if (previousText.length - nextText.length !== 1) return null;

  let deletionOffset = 0;
  while (
    deletionOffset < nextText.length &&
    previousText[deletionOffset] === nextText[deletionOffset]
  ) {
    deletionOffset += 1;
  }

  const chip = ranges.find(
    (range) => deletionOffset >= range.start && deletionOffset < range.end,
  );
  if (!chip) return null;

  const start = chip.start;
  const end = chip.end;
  const text = `${previousText.slice(0, start)}${previousText.slice(end)}`;
  const delta = end - start;
  const nextRanges = ranges
    .filter((range) => range !== chip)
    .map((range) =>
      range.start >= end
        ? { ...range, start: range.start - delta, end: range.end - delta }
        : range,
    );

  return { text, ranges: nextRanges };
};

export function useChatInputController(args: {
  participants: ChatParticipant[];
  cardTagSource: ChatCardTagCandidate[];
  initialText?: string;
}) {
  const [text, setText] = useState(args.initialText ?? "");
  const [chipRanges, setChipRanges] = useState<ChipRange[]>([]);
  const [activePopover, setActivePopover] = useState<ActiveChatPopover | null>(null);
  const selectionRef = useRef({ start: 0, end: 0 });

  const closePopover = useCallback(() => setActivePopover(null), []);

  const updateActivePopover = useCallback((nextText: string) => {
    const trigger = findTrigger(nextText);
    setActivePopover(trigger);
  }, []);

  const onChangeText = useCallback(
    (nextText: string) => {
      const atomicDelete = removeChipAtDeletion(text, nextText, chipRanges);
      if (atomicDelete) {
        setText(atomicDelete.text);
        setChipRanges(atomicDelete.ranges);
        updateActivePopover(atomicDelete.text);
        return;
      }

      const delta = nextText.length - text.length;
      const cursor = selectionRef.current.start;
      const adjustedRanges = chipRanges.map((range) => {
        if (cursor <= range.start) {
          return { ...range, start: range.start + delta, end: range.end + delta };
        }
        if (cursor > range.start && cursor < range.end) {
          return { ...range, end: range.end + delta };
        }
        return range;
      });

      setText(nextText);
      setChipRanges(adjustedRanges);
      updateActivePopover(nextText);
    },
    [chipRanges, text, updateActivePopover],
  );

  const onSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      selectionRef.current = event.nativeEvent.selection;
    },
    [],
  );

  const removeChip = useCallback((chip: ChipRange) => {
    const nextText = `${text.slice(0, chip.start)}${text.slice(chip.end)}`;
    const delta = chip.end - chip.start;
    setText(nextText);
    setChipRanges((prev) =>
      prev
        .filter((range) => range !== chip)
        .map((range) =>
          range.start >= chip.end
            ? { ...range, start: range.start - delta, end: range.end - delta }
            : range,
        ),
    );
    updateActivePopover(nextText);
  }, [text, updateActivePopover]);

  const onKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (event.nativeEvent.key !== "Backspace") return;
      const cursor = selectionRef.current.start;
      const chip = chipRanges.find((range) => range.end === cursor);
      if (chip) removeChip(chip);
    },
    [chipRanges, removeChip],
  );

  const replaceTriggerWithChip = useCallback(
    (popover: ActiveChatPopover, type: ChipRange["type"], refId: string, displayLabel: string) => {
      const token = `${triggerFor(type)}${displayLabel}`;
      const nextText = `${text.slice(0, popover.triggerIndex)}${token}${text.slice(popover.triggerIndex + popover.searchText.length + 1)}`;
      const start = popover.triggerIndex;
      const end = start + token.length;
      const delta = token.length - (popover.searchText.length + 1);
      const shiftedRanges = chipRanges.map((range) =>
        range.start > popover.triggerIndex
          ? { ...range, start: range.start + delta, end: range.end + delta }
          : range,
      );
      setText(nextText);
      setChipRanges([...shiftedRanges, { type, refId, displayLabel, start, end }]);
      setActivePopover(null);
      selectionRef.current = { start: end, end };
    },
    [chipRanges, text],
  );

  const onSelectMention = useCallback(
    (participant: ChatParticipant) => {
      if (!activePopover || activePopover.type !== "mention") return;
      if (chipRanges.filter((range) => range.type === "mention").length >= MAX_MENTIONS) {
        Alert.alert("Mention limit reached", "You can mention up to 10 people in one message.");
        return;
      }
      if (chipRanges.some((range) => range.type === "mention" && range.refId === participant.userId)) {
        setActivePopover(null);
        return;
      }
      replaceTriggerWithChip(activePopover, "mention", participant.userId, participant.displayName);
    },
    [activePopover, chipRanges, replaceTriggerWithChip],
  );

  const onSelectCardTag = useCallback(
    (card: ChatCardTagCandidate) => {
      if (!activePopover || activePopover.type !== "card") return;
      if (chipRanges.filter((range) => range.type === "card").length >= MAX_CARD_TAGS) {
        Alert.alert("Card tag limit reached", "You can tag up to 5 cards in one message.");
        return;
      }
      if (chipRanges.some((range) => range.type === "card" && range.refId === card.savedCardId)) {
        setActivePopover(null);
        return;
      }
      replaceTriggerWithChip(activePopover, "card", card.savedCardId, card.title);
    },
    [activePopover, chipRanges, replaceTriggerWithChip],
  );

  const filteredParticipants = useMemo(() => {
    if (activePopover?.type !== "mention") return args.participants;
    const query = activePopover.searchText.trim().toLowerCase();
    if (!query) return args.participants;
    return args.participants.filter((participant) =>
      participant.displayName.toLowerCase().includes(query) ||
      (participant.username ?? "").toLowerCase().includes(query),
    );
  }, [activePopover, args.participants]);

  const filteredCards = useMemo(() => {
    if (activePopover?.type !== "card") return args.cardTagSource;
    const query = activePopover.searchText.trim().toLowerCase();
    if (!query) return args.cardTagSource;
    return args.cardTagSource.filter((card) =>
      card.title.toLowerCase().includes(query) ||
      (card.category ?? "").toLowerCase().includes(query),
    );
  }, [activePopover, args.cardTagSource]);

  const serializeForSend = useCallback((): {
    content: string;
    mentions: MentionEntry[];
    cardTags: CardTagEntry[];
  } => {
    const mentions = chipRanges
      .filter((range) => range.type === "mention")
      .map((range) => ({
        userId: range.refId,
        displayName: range.displayLabel,
        startOffset: range.start,
        endOffset: range.end,
      }));

    const cardTags = chipRanges
      .filter((range) => range.type === "card")
      .map((range) => {
        const card = args.cardTagSource.find((candidate) => candidate.savedCardId === range.refId);
        return card
          ? { savedCardId: card.savedCardId, cardPayload: trimCardPayload(card.cardPayload) }
          : null;
      })
      .filter((entry): entry is CardTagEntry => entry !== null);

    return { content: text.trim(), mentions, cardTags };
  }, [args.cardTagSource, chipRanges, text]);

  const reset = useCallback(() => {
    setText("");
    setChipRanges([]);
    setActivePopover(null);
    selectionRef.current = { start: 0, end: 0 };
  }, []);

  const setDraftText = useCallback((nextText: string) => {
    setText(nextText);
    setChipRanges([]);
    updateActivePopover(nextText);
  }, [updateActivePopover]);

  return {
    text,
    chipRanges,
    activePopover,
    filteredParticipants,
    filteredCards,
    onChangeText,
    onKeyPress,
    onSelectionChange,
    onSelectMention,
    onSelectCardTag,
    closePopover,
    serializeForSend,
    reset,
    setDraftText,
  };
}
