import React from "react";
import { StyleSheet, View } from "react-native";
import { CardPreview } from "./CardPreview";
import type { CardTagEntry } from "../../services/messagingService";

interface ChatCardChipProps {
  cardTag: CardTagEntry;
  onPress: (cardTag: CardTagEntry) => void;
}

export function ChatCardChip({ cardTag, onPress }: ChatCardChipProps): React.ReactElement {
  const payload = cardTag.cardPayload;
  return (
    <View style={styles.container}>
      <CardPreview
        title={payload.title || "Saved experience"}
        category={payload.category ?? undefined}
        categoryIcon={payload.categoryIcon}
        imageUrl={payload.image ?? payload.images?.[0] ?? undefined}
        onPress={() => onPress(cardTag)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 6,
  },
});
