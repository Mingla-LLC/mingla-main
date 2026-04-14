import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import WizardChrome from "../onboarding/WizardChrome";
import type { ExtractedMenuItem } from "../../services/menuService";
import {
  colors,
  spacing,
  radius,
  fontWeights,
  surface,
  border,
  shadows,
} from "../../constants/designSystem";

const DIETARY_COLORS: Record<string, { bg: string; text: string }> = {
  vegetarian: { bg: "#f0fdf4", text: "#15803d" },
  vegan: { bg: "#f0fdf4", text: "#15803d" },
  "gluten-free": { bg: "#fffbeb", text: "#b45309" },
  "contains-nuts": { bg: "#fef2f2", text: "#b91c1c" },
  "contains-fish": { bg: "#eff6ff", text: "#1d4ed8" },
  "contains-shellfish": { bg: "#eff6ff", text: "#1d4ed8" },
};

interface ReviewItemsProps {
  items: ExtractedMenuItem[];
  onSave: (items: ExtractedMenuItem[]) => void;
  onBack: () => void;
}

export default function ReviewItems({
  items: initialItems,
  onSave,
  onBack,
}: ReviewItemsProps): React.JSX.Element {
  const [items, setItems] = useState<ExtractedMenuItem[]>(initialItems);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const groupedByCategory = items.reduce<Record<string, ExtractedMenuItem[]>>(
    (acc, item) => {
      const cat = item.category || "Other";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    },
    {}
  );

  const handleDelete = (index: number): void => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleEdit = (index: number, field: string, value: string | number): void => {
    setItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    );
  };

  const handleAddManual = (): void => {
    const newItem: ExtractedMenuItem = {
      name: "",
      description: null,
      price: 0,
      category: "Other",
      dietary_tags: [],
      confidence: 1,
    };
    setItems((prev) => [...prev, newItem]);
    setEditingIndex(items.length);
  };

  let globalIndex = 0;

  return (
    <WizardChrome
      currentStep={1}
      totalSteps={2}
      onBack={onBack}
      onContinue={() => {
        const valid = items.filter((i) => i.name.trim().length > 0 && i.price > 0);
        if (valid.length === 0) {
          Alert.alert("No items", "Add at least one item with a name and price.");
          return;
        }
        onSave(valid);
      }}
      continueLabel="Save & continue →"
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>We found {items.length} items</Text>
        <Text style={styles.subtitle}>
          Review and edit anything that needs fixing.
        </Text>

        {Object.entries(groupedByCategory).map(([category, catItems]) => (
          <View key={category}>
            <Text style={styles.categoryHeader}>
              {category} ({catItems.length})
            </Text>
            {catItems.map((item) => {
              const idx = globalIndex++;
              const isEditing = editingIndex === idx;
              const isUncertain = item.confidence < 0.7;

              return (
                <TouchableOpacity
                  key={`${item.name}-${idx}`}
                  style={[
                    styles.itemCard,
                    isUncertain && styles.itemCardUncertain,
                  ]}
                  onPress={() =>
                    setEditingIndex(isEditing ? null : idx)
                  }
                  activeOpacity={0.85}
                >
                  <View style={styles.itemRow}>
                    <View style={styles.itemInfo}>
                      {isEditing ? (
                        <TextInput
                          style={styles.editInput}
                          value={item.name}
                          onChangeText={(v) => handleEdit(idx, "name", v)}
                          autoFocus
                          placeholder="Item name"
                        />
                      ) : (
                        <Text style={styles.itemName}>{item.name}</Text>
                      )}
                      {item.description && !isEditing && (
                        <Text style={styles.itemDesc} numberOfLines={2}>
                          {item.description}
                        </Text>
                      )}
                    </View>
                    <View style={styles.itemRight}>
                      {isEditing ? (
                        <TextInput
                          style={styles.priceInput}
                          value={String(item.price)}
                          onChangeText={(v) =>
                            handleEdit(idx, "price", parseFloat(v) || 0)
                          }
                          keyboardType="decimal-pad"
                        />
                      ) : (
                        <Text style={styles.itemPrice}>
                          ${item.price.toFixed(2)}
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* Dietary tags */}
                  {item.dietary_tags.length > 0 && (
                    <View style={styles.tagsRow}>
                      {item.dietary_tags.map((tag) => {
                        const tagColors = DIETARY_COLORS[tag] ?? {
                          bg: colors.gray[100],
                          text: colors.text.secondary,
                        };
                        return (
                          <View
                            key={tag}
                            style={[
                              styles.tagPill,
                              { backgroundColor: tagColors.bg },
                            ]}
                          >
                            <Text
                              style={[
                                styles.tagText,
                                { color: tagColors.text },
                              ]}
                            >
                              {tag}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Uncertain badge */}
                  {isUncertain && !isEditing && (
                    <View style={styles.uncertainBadge}>
                      <Ionicons
                        name="alert-circle"
                        size={14}
                        color="#b45309"
                      />
                      <Text style={styles.uncertainText}>Check this</Text>
                    </View>
                  )}

                  {/* Delete button when editing */}
                  {isEditing && (
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => handleDelete(idx)}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={18}
                        color={colors.error[500]}
                      />
                      <Text style={styles.deleteText}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        {/* Add manual */}
        <TouchableOpacity
          style={styles.addButton}
          onPress={handleAddManual}
          activeOpacity={0.85}
        >
          <Ionicons
            name="add-circle-outline"
            size={20}
            color={colors.primary[500]}
          />
          <Text style={styles.addText}>Add an item manually</Text>
        </TouchableOpacity>
      </ScrollView>
    </WizardChrome>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    fontSize: 24,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.text.tertiary,
    marginBottom: spacing.lg,
  },
  categoryHeader: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  itemCard: {
    backgroundColor: surface.card,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: spacing.sm,
  },
  itemCardUncertain: {
    borderColor: "#fbbf24",
    borderWidth: 1.5,
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  itemInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  itemName: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  itemDesc: {
    fontSize: 13,
    color: colors.text.tertiary,
    marginTop: 2,
  },
  itemRight: {
    alignItems: "flex-end",
  },
  itemPrice: {
    fontSize: 16,
    fontWeight: fontWeights.bold,
    color: colors.primary[500],
  },
  editInput: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary[500],
    paddingBottom: 4,
    marginBottom: 4,
  },
  priceInput: {
    fontSize: 16,
    fontWeight: fontWeights.bold,
    color: colors.primary[500],
    borderBottomWidth: 1,
    borderBottomColor: colors.primary[500],
    paddingBottom: 4,
    width: 80,
    textAlign: "right",
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  tagPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  tagText: {
    fontSize: 11,
    fontWeight: fontWeights.medium,
  },
  uncertainBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
  },
  uncertainText: {
    fontSize: 12,
    fontWeight: fontWeights.medium,
    color: "#b45309",
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 12,
    paddingVertical: 4,
  },
  deleteText: {
    fontSize: 13,
    color: colors.error[500],
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 52,
    borderWidth: 1.5,
    borderColor: colors.gray[300],
    borderStyle: "dashed",
    borderRadius: radius.lg,
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  addText: {
    fontSize: 15,
    fontWeight: fontWeights.medium,
    color: colors.primary[500],
  },
});
