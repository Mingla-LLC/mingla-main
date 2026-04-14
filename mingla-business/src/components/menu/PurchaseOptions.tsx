import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import WizardChrome from "../onboarding/WizardChrome";
import type { PurchaseOptionSuggestion } from "../../services/menuService";
import {
  colors,
  spacing,
  radius,
  fontWeights,
  surface,
  border,
  shadows,
} from "../../constants/designSystem";

interface AcceptedOption {
  name: string;
  description: string;
  price: number;
  price_unit: string;
}

interface PurchaseOptionsProps {
  suggestions: PurchaseOptionSuggestion[];
  onPublish: (options: AcceptedOption[]) => void;
  onBack: () => void;
  publishing: boolean;
}

export default function PurchaseOptions({
  suggestions,
  onPublish,
  onBack,
  publishing,
}: PurchaseOptionsProps): React.JSX.Element {
  const [pending, setPending] = useState<PurchaseOptionSuggestion[]>(suggestions);
  const [accepted, setAccepted] = useState<AcceptedOption[]>([]);
  const [showManual, setShowManual] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualDesc, setManualDesc] = useState("");
  const [manualPrice, setManualPrice] = useState("");

  const handleAccept = (suggestion: PurchaseOptionSuggestion): void => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAccepted((prev) => [
      ...prev,
      {
        name: suggestion.name,
        description: suggestion.description,
        price: suggestion.price,
        price_unit: suggestion.price_unit,
      },
    ]);
    setPending((prev) => prev.filter((s) => s.name !== suggestion.name));
  };

  const handleDismiss = (name: string): void => {
    setPending((prev) => prev.filter((s) => s.name !== name));
  };

  const handleAddManual = (): void => {
    if (!manualName.trim() || !manualPrice) {
      Alert.alert("Missing info", "Enter a name and price.");
      return;
    }
    setAccepted((prev) => [
      ...prev,
      {
        name: manualName.trim(),
        description: manualDesc.trim(),
        price: parseFloat(manualPrice) || 0,
        price_unit: "person",
      },
    ]);
    setManualName("");
    setManualDesc("");
    setManualPrice("");
    setShowManual(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <WizardChrome
      currentStep={2}
      totalSteps={2}
      onBack={onBack}
      onContinue={() => {
        if (accepted.length === 0) {
          Alert.alert(
            "No options",
            "Accept a suggestion or create your own purchase option."
          );
          return;
        }
        onPublish(accepted);
      }}
      continueLabel="Publish →"
      continueLoading={publishing}
      continueDisabled={accepted.length === 0}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Purchase options</Text>
        <Text style={styles.subtitle}>
          Guests see these on your card. They can buy them directly.
        </Text>

        {/* AI Suggestions */}
        {pending.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>AI suggestions</Text>
            {pending.map((suggestion) => (
              <View key={suggestion.name} style={styles.suggestionCard}>
                <Text style={styles.suggestionName}>{suggestion.name}</Text>
                <Text style={styles.suggestionPrice}>
                  ${suggestion.price.toFixed(2)} / {suggestion.price_unit}
                </Text>
                <Text style={styles.suggestionDesc}>
                  {suggestion.description}
                </Text>
                <View style={styles.suggestionActions}>
                  <TouchableOpacity
                    style={styles.acceptButton}
                    onPress={() => handleAccept(suggestion)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.acceptText}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.dismissButton}
                    onPress={() => handleDismiss(suggestion.name)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close" size={18} color={colors.gray[400]} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        )}

        {/* Accepted options */}
        <Text style={styles.sectionLabel}>
          Your options{accepted.length > 0 ? ` (${accepted.length})` : ""}
        </Text>
        {accepted.length === 0 ? (
          <Text style={styles.emptyText}>
            Accept suggestions above or create your own.
          </Text>
        ) : (
          accepted.map((opt, i) => (
            <View key={`${opt.name}-${i}`} style={styles.acceptedCard}>
              <View style={styles.acceptedRow}>
                <Text style={styles.acceptedName}>{opt.name}</Text>
                <Text style={styles.acceptedPrice}>
                  ${opt.price.toFixed(2)}
                </Text>
              </View>
              <Text style={styles.acceptedDesc}>{opt.description}</Text>
              <TouchableOpacity
                onPress={() => {
                  setAccepted((prev) => prev.filter((_, idx) => idx !== i));
                }}
              >
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        {/* Manual add */}
        {showManual ? (
          <View style={styles.manualForm}>
            <TextInput
              style={styles.manualInput}
              value={manualName}
              onChangeText={setManualName}
              placeholder="Option name"
              placeholderTextColor={colors.text.tertiary}
            />
            <TextInput
              style={styles.manualInput}
              value={manualDesc}
              onChangeText={setManualDesc}
              placeholder="Description"
              placeholderTextColor={colors.text.tertiary}
            />
            <TextInput
              style={styles.manualInput}
              value={manualPrice}
              onChangeText={setManualPrice}
              placeholder="Price"
              placeholderTextColor={colors.text.tertiary}
              keyboardType="decimal-pad"
            />
            <View style={styles.manualActions}>
              <TouchableOpacity
                style={styles.manualSave}
                onPress={handleAddManual}
              >
                <Text style={styles.manualSaveText}>Add</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowManual(false)}>
                <Text style={styles.manualCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setShowManual(true)}
            activeOpacity={0.85}
          >
            <Ionicons
              name="add-circle-outline"
              size={20}
              color={colors.primary[500]}
            />
            <Text style={styles.addText}>Create a purchase option</Text>
          </TouchableOpacity>
        )}
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
  sectionLabel: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  suggestionCard: {
    backgroundColor: colors.primary[50],
    borderWidth: 1.5,
    borderColor: colors.primary[200],
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  suggestionName: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  suggestionPrice: {
    fontSize: 18,
    fontWeight: fontWeights.bold,
    color: colors.primary[600],
    marginTop: 2,
  },
  suggestionDesc: {
    fontSize: 14,
    color: colors.text.secondary,
    marginTop: 4,
    lineHeight: 20,
  },
  suggestionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  acceptButton: {
    backgroundColor: colors.success[500],
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  acceptText: {
    fontSize: 14,
    fontWeight: fontWeights.semibold,
    color: "#fff",
  },
  dismissButton: {
    padding: 8,
  },
  acceptedCard: {
    backgroundColor: surface.card,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  acceptedRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  acceptedName: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    flex: 1,
  },
  acceptedPrice: {
    fontSize: 16,
    fontWeight: fontWeights.bold,
    color: colors.primary[500],
  },
  acceptedDesc: {
    fontSize: 13,
    color: colors.text.tertiary,
    marginTop: 4,
  },
  removeText: {
    fontSize: 13,
    color: colors.error[500],
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    color: colors.text.tertiary,
    fontStyle: "italic",
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
  manualForm: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  manualInput: {
    height: 48,
    backgroundColor: surface.input,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text.primary,
  },
  manualActions: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
  },
  manualSave: {
    backgroundColor: colors.primary[500],
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  manualSaveText: {
    fontSize: 14,
    fontWeight: fontWeights.semibold,
    color: "#fff",
  },
  manualCancelText: {
    fontSize: 14,
    color: colors.text.tertiary,
  },
});
