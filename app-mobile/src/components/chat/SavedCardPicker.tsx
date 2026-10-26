/**
 * ORCH-0667 shared-card picker, moved out of MessageInterface by Issue #4114
 * Wave 3 and redrawn on the dark chat tokens. The send itself stays in
 * MessageInterface.handleSelectCardToShare (real send, real toasts).
 * States: loading skeleton, empty (with why + OK), the list, and one row
 * submitting at a time.
 */
import React from "react";
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";

export interface SavedCardPickerItem {
  id: string;
  title?: string | null;
  image?: string | null;
  category?: string | null;
}

interface SavedCardPickerProps {
  friendName: string;
  isLoading: boolean;
  cards: readonly SavedCardPickerItem[] | undefined;
  submittingCardId: string | null;
  onSelect: (card: SavedCardPickerItem) => void;
  onClose: () => void;
}

export function SavedCardPicker({
  friendName,
  isLoading,
  cards,
  submittingCardId,
  onSelect,
  onClose,
}: SavedCardPickerProps): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  return (
    <View style={styles.overlay}>
      <View style={styles.container} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {t("chat:pickerTitle")}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel={t("chat:a11yClosePicker")}
          >
            <Icon name="close" size={14} color={chatTokens.textSecondary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>{t("chat:pickerSubtitle", { name: friendName })}</Text>

        {isLoading ? (
          <View style={styles.list}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeletonRow}>
                <View style={styles.skeletonThumb} />
                <View style={styles.skeletonText}>
                  <View style={[styles.skeletonBar, { width: "60%" }]} />
                  <View style={[styles.skeletonBar, { width: "40%", marginTop: 6 }]} />
                </View>
              </View>
            ))}
          </View>
        ) : (cards?.length ?? 0) === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t("chat:noSavedCardsToShareTitle")}</Text>
            <Text style={styles.emptyBody}>{t("chat:noSavedCardsToShareBody")}</Text>
            <TouchableOpacity onPress={onClose} style={styles.confirmButton} accessibilityRole="button">
              <Text style={styles.confirmButtonText}>{t("chat:ok")}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView style={styles.list}>
            {cards?.map((card) => {
              const isSubmitting = submittingCardId === card.id;
              const isOtherSubmitting = !!submittingCardId && submittingCardId !== card.id;
              return (
                <TouchableOpacity
                  key={card.id}
                  onPress={() => onSelect(card)}
                  disabled={isSubmitting || isOtherSubmitting}
                  style={[styles.row, isSubmitting && styles.rowSubmitting]}
                  accessibilityRole="button"
                  accessibilityLabel={card.title ?? ""}
                  accessibilityState={{ busy: isSubmitting, disabled: isSubmitting || isOtherSubmitting }}
                >
                  {card.image ? (
                    <Image source={{ uri: card.image }} style={styles.thumb} />
                  ) : (
                    <View style={[styles.thumb, styles.thumbPlaceholder]}>
                      <Icon name="bookmark" size={20} color={chatTokens.textMuted} />
                    </View>
                  )}
                  <View style={styles.info}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {card.title}
                    </Text>
                    <Text style={styles.cardSubtitle} numberOfLines={1}>
                      {isSubmitting ? t("chat:cardSending") : card.category || ""}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: chatTokens.scrim,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 50,
  },
  container: {
    backgroundColor: chatTokens.surface,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.chromeHairline,
    padding: 20,
    width: "100%",
    maxWidth: 400,
    maxHeight: "80%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: chatTokens.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  subtitle: {
    fontSize: 14,
    color: chatTokens.textSoft,
    marginBottom: 12,
  },
  list: {
    marginBottom: 8,
  },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.chromeHairline,
  },
  rowSubmitting: {
    opacity: 0.5,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: chatTokens.surfaceRaised,
  },
  thumbPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  cardSubtitle: {
    fontSize: 12,
    color: chatTokens.textSoft,
    marginTop: 2,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  skeletonThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: chatTokens.surfaceRaised,
  },
  skeletonText: {
    flex: 1,
  },
  skeletonBar: {
    height: 10,
    borderRadius: 4,
    backgroundColor: chatTokens.surfaceRaised,
  },
  empty: {
    paddingHorizontal: 12,
    paddingVertical: 24,
    alignItems: "center",
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: chatTokens.textPrimary,
    textAlign: "center",
  },
  emptyBody: {
    fontSize: 14,
    color: chatTokens.textSoft,
    textAlign: "center",
  },
  confirmButton: {
    alignSelf: "stretch",
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: chatTokens.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
});
