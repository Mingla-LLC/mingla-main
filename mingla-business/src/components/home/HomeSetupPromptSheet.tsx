/**
 * #4389 (screen H2) — the one-time sheet for an existing brand that is
 * missing bank country, terms or payment details. Once per device per brand,
 * owners and admins only; "Later" keeps the Home card (S-8).
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { spacing, text as textTokens, typography } from "../../constants/designSystem";
import type { BrandSetupFacts } from "../../services/brandSetupService";
import { Button } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { HOME_SETUP_COPY as C } from "./homeSetupCopy";

/** The missing items, in checklist order. */
export function homeSetupMissing(
  facts: Pick<BrandSetupFacts, "market" | "terms" | "details">,
): Array<{ key: "country" | "terms" | "payments"; label: string; icon: IconName }> {
  const out: Array<{ key: "country" | "terms" | "payments"; label: string; icon: IconName }> = [];
  if (!facts.market) out.push({ key: "country", label: C.h2.country, icon: "location" });
  if (!facts.terms) out.push({ key: "terms", label: C.h2.terms, icon: "notebook" });
  if (!facts.details) out.push({ key: "payments", label: C.h2.payments, icon: "bank" });
  return out;
}

export interface HomeSetupPromptSheetProps {
  visible: boolean;
  brandName: string;
  facts: Pick<BrandSetupFacts, "market" | "terms" | "details">;
  onLater: () => void;
  onFinish: () => void;
}

export const HomeSetupPromptSheet: React.FC<HomeSetupPromptSheetProps> = ({
  visible,
  brandName,
  facts,
  onLater,
  onFinish,
}) => (
  <Sheet visible={visible} onClose={onLater} snapPoint="half">
    <View style={styles.body} testID="home-setup-prompt">
      <Text style={styles.title} accessibilityRole="header">
        {C.h2.title(brandName)}
      </Text>
      <View style={styles.list}>
        {homeSetupMissing(facts).map((row) => (
          <View key={row.key} style={styles.row}>
            <Icon name={row.icon} size={18} color={textTokens.secondary} />
            <Text style={styles.rowText}>{row.label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.btns}>
        <View style={styles.btn}>
          <Button label={C.h2.later} onPress={onLater} variant="secondary" size="md" fullWidth />
        </View>
        <View style={styles.btn}>
          <Button
            label={C.h2.finish}
            onPress={onFinish}
            variant="primary"
            size="md"
            fullWidth
            testID="home-setup-prompt-finish"
          />
        </View>
      </View>
    </View>
  </Sheet>
);

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  title: { ...typography.h3, color: textTokens.primary },
  list: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  rowText: { ...typography.body, color: textTokens.primary },
  btns: { flexDirection: "row", gap: spacing.sm },
  btn: { flex: 1 },
});
