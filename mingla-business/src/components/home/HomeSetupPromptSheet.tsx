/**
 * #4389 (screen H2) — the one-time sheet for an existing brand that is
 * missing bank country, terms or payment details. Once per device per brand,
 * owners and admins only; "Later" keeps the Home card (S-8).
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  color,
  space,
  type,
} from "../../constants/designSystem";
import type { BrandSetupFacts } from "../../services/brandSetupService";
import { Button } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { SheetScrollLayout } from "../ui/SheetScrollLayout";
import { HOME_SETUP_PROMPT_COPY as C } from "./homeSetupPromptCopy";

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
    <SheetScrollLayout
      testID="home-setup-prompt"
      footer={
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
      }
    >
      <Text style={styles.title} accessibilityRole="header">
        {C.h2.title(brandName)}
      </Text>
      <View style={styles.list}>
        {homeSetupMissing(facts).map((row) => (
          <View key={row.key} style={styles.row}>
            <Icon name={row.icon} size={18} color={color.text2} />
            <Text style={styles.rowText}>{row.label}</Text>
          </View>
        ))}
      </View>
    </SheetScrollLayout>
  </Sheet>
);

const styles = StyleSheet.create({
  title: { ...type.h1, color: color.text1 },
  list: { gap: space[2] },
  row: { flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 44 },
  rowText: { ...type.body, color: color.text1 },
  // Side by side; each label wraps at large text instead of clipping.
  btns: { flexDirection: "row", gap: space[2], alignItems: "stretch" },
  btn: { flex: 1 },
});
